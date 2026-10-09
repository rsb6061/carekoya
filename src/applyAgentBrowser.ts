// Drives an employer's application form in Cloudflare Browser Rendering for a caregiver who clicked
// "Apply for me". Ported from JobPlots' Apply agent; see applyAgentRules.ts for what it may answer.
import { connect, launch, type BrowserWorker } from "@cloudflare/playwright";
import { snapshotElements } from "./applyAgentSnapshot";
import {
  allowedApplyNavigation,
  applyAnswer,
  answerValueKind,
  classifyApplicationQuestion,
  declineOption,
  eeoCategory,
  isSensitiveOrAttestation,
  type EeoCategory,
  type ApplyProvider,
  type ApplyAnswerKey,
  type ApplyProfile,
} from "./applyAgentRules";

export interface ApplicationResume {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ApplicationAgentRunInput {
  provider: ApplyProvider;
  applicationUrl: string;
  profile: ApplyProfile;
  resume: ApplicationResume;
  // Answers the caregiver gave in CareJoys for this application, by PendingQuestion.id.
  oneTimeAnswers?: Record<string, string | boolean>;
  // Fill-only test: never attach files (some job sites upload on attach).
  skipFileUpload?: boolean;
}

// A missing answer CareJoys can ask for itself (instead of handing over the live browser).
export interface PendingQuestion {
  id: string;
  label: string;
  canonicalKey: ApplyAnswerKey | null;
  kind: "text" | "number" | "date" | "email" | "tel" | "select" | "yesno" | "choice" | "agree";
  options: string[];
  required: boolean;
  // Set for voluntary EEO self-ID questions (optional to answer; remembered only on request).
  eeoCategory?: EeoCategory;
}

// The browser stays open (keep-alive) for this long after a pause; continue must happen within it.
export const APPLICATION_PAUSE_MS = 600000;

export interface ObservedQuestion {
  text: string;
  canonicalKey: string | null;
  required: boolean;
  reusePolicy: string;
}

export type ApplicationAgentRunResult =
  | {
      status: "submitted";
      currentUrl: string;
      observedQuestions: ObservedQuestion[];
    }
  | {
      status: "needs_answers";
      currentUrl: string;
      browserSessionId: string;
      questions: PendingQuestion[];
      observedQuestions: ObservedQuestion[];
    }
  | {
      status: "handoff_required";
      currentUrl: string;
      liveViewUrl: string;
      blockerCode: string;
      blockerMessage: string;
      observedQuestions: ObservedQuestion[];
    }
  | {
      status: "failed";
      currentUrl: string | null;
      error: string;
      observedQuestions: ObservedQuestion[];
    };

// Visible fields, plus file inputs even when hidden behind an "Upload résumé" button.
// Hidden checkboxes are included for Ashby-style yes/no questions (skipped unless driven by Yes/No buttons).
const APPLICATION_CONTROL_SELECTOR =
  'input:visible,select:visible,textarea:visible,[role="combobox"]:visible,[contenteditable="true"]:visible,input[type="file"]:not(:visible),input[type="checkbox"]:not(:visible)';

interface ControlSnapshot {
  index: number;
  tag: string;
  role: string;
  type: string;
  name: string;
  id: string;
  text: string;
  label: string;
  required: boolean;
  visible: boolean;
  hasValue: boolean;
  // Ashby-style yes/no: a hidden checkbox driven by "Yes"/"No" buttons.
  yesNoButtons: boolean;
  options: Array<{ value: string; label: string }>;
}

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function truthyChoice(answer: boolean, optionText: string) {
  const value = normalize(optionText);
  if (answer) return /^(yes|true|y|1)$|\byes\b/.test(value);
  return /^(no|false|n|0)$|\bno\b/.test(value);
}

function optionForAnswer(
  control: ControlSnapshot,
  answer: string | boolean | number,
) {
  const expected = normalize(answer);
  if (typeof answer === "boolean") {
    return control.options.find((option) =>
      truthyChoice(answer, option.label || option.value),
    );
  }
  return (
    control.options.find(
      (option) =>
        normalize(option.value) === expected ||
        normalize(option.label) === expected,
    ) ||
    control.options.find(
      (option) =>
        normalize(option.label).includes(expected) ||
        expected.includes(normalize(option.label)),
    )
  );
}

async function applicationForm(page: any) {
  const forms = page.locator("form");
  const count = await forms.count();
  let winner: any = null;
  let best = -999;
  for (let index = 0; index < count; index++) {
    const form = forms.nth(index);
    if (!(await form.isVisible().catch(() => false))) continue;
    const text = normalize(await form.innerText().catch(() => ""));
    const inputs = await form.locator(APPLICATION_CONTROL_SELECTOR).count();
    let score = inputs;
    if (/email|resume|first name|last name|phone|application/.test(text)) score += 20;
    if (/continue|next|submit application|apply/.test(text)) score += 8;
    if (/search jobs|keyword search|radius search/.test(text)) score -= 25;
    if (score > best) {
      best = score;
      winner = form;
    }
  }
  return winner || page.locator("body");
}

async function controlSnapshots(form: any): Promise<ControlSnapshot[]> {
  return form.locator(APPLICATION_CONTROL_SELECTOR).evaluateAll(snapshotElements);
}

async function createHandoff(
  page: any,
  blockerCode: string,
  blockerMessage: string,
  observedQuestions: ObservedQuestion[],
): Promise<ApplicationAgentRunResult> {
  const context = page.context();
  const cdp = await context.newCDPSession(page);
  const { devtoolsFrontendUrl } = await cdp.send("Cloudflare.getLiveView", {
    mode: "tab",
    expiresInMs: 600000,
  });
  await cdp.send("Cloudflare.handoff", {
    instructions: blockerMessage,
    timeout: 600000,
  });
  return {
    status: "handoff_required",
    currentUrl: page.url(),
    liveViewUrl: devtoolsFrontendUrl,
    blockerCode,
    blockerMessage,
    observedQuestions,
  };
}

async function successDetected(page: any) {
  const url = normalize(page.url());
  if (/thank|success|confirmation|submitted/.test(url)) return true;
  const text = normalize((await page.locator("body").innerText().catch(() => "")).slice(0, 5000));
  return /thank you.*apply|application.*received|application.*submitted|successfully submitted|we have received your application/.test(
    text,
  );
}

// A visible human-verification widget (invisible reCAPTCHA badges don't count).
async function captchaDetected(page: any) {
  const body = normalize((await page.locator("body").innerText().catch(() => "")).slice(0, 4000));
  const frames = await page
    .locator('iframe[src*="captcha"]:visible,iframe[src*="recaptcha"]:visible,iframe[src*="hcaptcha"]:visible,iframe[src*="turnstile"]:visible')
    .evaluateAll((els: Element[]) => els.filter((f) => !/size=invisible/.test((f as HTMLIFrameElement).src) && f.getBoundingClientRect().height > 30).length)
    .catch(() => 0);
  return frames > 0 || /verify you are human|security check/.test(body);
}

// Stable id for a control across re-snapshots of the same page.
export function questionId(control: { name: string; id: string; label: string; text: string }) {
  const basis = control.name || control.id || control.label || control.text;
  let h = 0;
  for (let i = 0; i < basis.length; i++) h = (h * 31 + basis.charCodeAt(i)) | 0;
  return "q" + (h >>> 0).toString(36);
}

function cleanLabel(control: ControlSnapshot) {
  return (control.label || control.text).replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

async function radioLabels(form: any, control: ControlSnapshot) {
  const radios = form.locator(`input[type="radio"][name="${control.name.replace(/"/g, '\\"')}"]`);
  const count = await radios.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    const radio = radios.nth(i);
    const id = (await radio.getAttribute("id")) || "";
    const label = id ? await form.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).innerText().catch(() => "") : "";
    labels.push((label || (await radio.getAttribute("value")) || "").trim());
  }
  return labels.filter(Boolean);
}

// Selects the option with this label in a select or radio group.
async function chooseOption(form: any, control: ControlSnapshot, label: string) {
  const want = normalize(label);
  if (control.tag === "select") {
    const option = control.options.find((o) => normalize(o.label || o.value) === want);
    if (!option) return false;
    const locator = form.locator(APPLICATION_CONTROL_SELECTOR).nth(control.index);
    await locator.selectOption(option.value).catch(async () => locator.selectOption({ label: option.label }));
    return true;
  }
  const radios = form.locator(`input[type="radio"][name="${control.name.replace(/"/g, '\\"')}"]`);
  const count = await radios.count();
  for (let i = 0; i < count; i++) {
    const radio = radios.nth(i);
    const id = (await radio.getAttribute("id")) || "";
    const text = id ? await form.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).innerText().catch(() => "") : "";
    if (normalize(text || (await radio.getAttribute("value")) || "") === want) {
      await radio.check();
      return true;
    }
  }
  return false;
}

// A question CareJoys can render itself: a plain field, select or radio group that is neither
// sensitive nor an attestation. Everything else (checkboxes, logins, unusual widgets) is a handoff.
async function askableQuestion(form: any, control: ControlSnapshot, key: ApplyAnswerKey | null): Promise<PendingQuestion | null> {
  const label = cleanLabel(control);
  if (!label) return null;
  const base = { id: questionId(control), label, canonicalKey: key, required: control.required };
  if (key && answerValueKind(key) === "boolean") return { ...base, kind: "yesno", options: ["Yes", "No"] };
  if (control.tag === "select") {
    const options = control.options.map((o) => (o.label || o.value).trim()).filter((o) => o && !/^(select|choose|--|please select)/i.test(o));
    return options.length ? { ...base, kind: "select", options } : null;
  }
  if (control.type === "radio") {
    const options = await radioLabels(form, control);
    return options.length ? { ...base, kind: "choice", options } : null;
  }
  if (control.yesNoButtons) return { ...base, kind: "yesno", options: ["Yes", "No"] };
  if (control.role === "combobox" || control.type === "checkbox") return null;
  if (control.tag === "textarea" || ["", "text", "search"].includes(control.type)) return { ...base, kind: "text", options: [] };
  if (["number", "date", "email", "tel"].includes(control.type)) return { ...base, kind: control.type as PendingQuestion["kind"], options: [] };
  return null;
}

// The field's own label decides what it asks; the wider surrounding text is only a fallback, so a flat form
// (every field in one container) doesn't make "First name" look like the race question next to it.
function classifyControl(control: ControlSnapshot) {
  const byLabel = control.label ? classifyApplicationQuestion(control.label) : null;
  if (byLabel && (byLabel.key || byLabel.sensitive || byLabel.attestation)) return byLabel;
  return classifyApplicationQuestion(control.text);
}

async function fillApplicationStep(
  page: any,
  input: ApplicationAgentRunInput,
) {
  const { profile, resume } = input;
  const form = await applicationForm(page);
  const snapshots = await controlSnapshots(form);
  const observedQuestions: ObservedQuestion[] = [];
  const blockers: ObservedQuestion[] = [];
  const askable: PendingQuestion[] = [];
  const filled: Array<{ label: string; key: string | null }> = [];
  const radioGroups = new Set<string>();

  const fileInputs = snapshots.filter((c) => c.type === "file");
  const resumeTarget =
    fileInputs.find((c) => /r[eé]sum[eé]|\bcv\b/i.test(c.label) && !/autofill|parse/i.test(c.text)) ||
    fileInputs.find((c) => !/cover letter|autofill|parse|transcript|portfolio|photo/i.test(c.text));

  for (const control of snapshots) {
    if (["hidden", "submit", "button", "reset", "image"].includes(control.type)) continue;
    if (control.type === "checkbox" && !control.visible && !control.yesNoButtons) continue;
    if (control.hasValue && control.type !== "file") continue;

    if (control.type === "file") {
      // One résumé, into the résumé field only (not cover letter, not an ATS "autofill" parser).
      if (control !== resumeTarget) continue;
      if (input.skipFileUpload) {
        filled.push({ label: cleanLabel(control) || "Résumé upload", key: "resume (skipped in test)" });
        continue;
      }
      const locator = form.locator(APPLICATION_CONTROL_SELECTOR).nth(control.index);
      await locator.setInputFiles({
        name: resume.name,
        mimeType: resume.mimeType,
        // Playwright wants a Node Buffer (nodejs_compat provides it on Workers).
        buffer: (globalThis as any).Buffer ? (globalThis as any).Buffer.from(resume.bytes) : resume.bytes,
      });
      continue;
    }

    if (control.type === "password") {
      blockers.push({
        text: control.text || "Password or account login required",
        canonicalKey: null,
        required: true,
        reusePolicy: "never_auto",
      });
      continue;
    }

    if (control.type === "radio") {
      const group = control.name || control.id;
      if (radioGroups.has(group)) continue;
      radioGroups.add(group);
    }

    const classification = classifyControl(control);
    const observed: ObservedQuestion = {
      text: control.text,
      canonicalKey: classification.key,
      required: control.required,
      reusePolicy: classification.reusePolicy,
    };
    observedQuestions.push(observed);

    // From the question label first: option text ("Hispanic or Latino") mustn't decide the category.
    const eeo = classification.sensitive ? eeoCategory(control.label) || eeoCategory(control.text) : null;
    if (eeo && (control.tag === "select" || control.type === "radio")) {
      const options = control.tag === "select"
        ? control.options.map((o) => (o.label || o.value).trim()).filter((o) => o && !/^(select|choose|--|please select)/i.test(o))
        : await radioLabels(form, control);
      // The caregiver's own pick for this form, else the employer's "decline to answer". Never remembered.
      const choice =
        (input.oneTimeAnswers?.[questionId(control)] as string | undefined) ||
        declineOption(options);
      if (choice && (await chooseOption(form, control, String(choice)))) {
        filled.push({ label: cleanLabel(control), key: "eeo:" + eeo });
        continue;
      }
      // No decline option: the caregiver picks in CareJoys.
      if (control.required) {
        askable.push({
          id: questionId(control), label: cleanLabel(control), canonicalKey: null,
          kind: control.tag === "select" ? "select" : "choice", options, required: control.required, eeoCategory: eeo,
        });
      }
      continue;
    }

    // A job site's own privacy/terms checkbox: the caregiver agrees in CareJoys, seeing the exact text.
    // Certifications, e-signatures and truthfulness statements still go to the live browser.
    if (
      classification.attestation && control.type === "checkbox" && control.visible &&
      /privacy|terms|policy|text messages|sms|communications?/i.test(control.text) &&
      !/certif|signature|truthful|accurate|under penalty/i.test(control.text)
    ) {
      const agreed = input.oneTimeAnswers?.[questionId(control)];
      if (agreed === true || /^(i agree|yes|true)$/i.test(String(agreed || ""))) {
        await form.locator(APPLICATION_CONTROL_SELECTOR).nth(control.index).check();
        filled.push({ label: cleanLabel(control), key: "agreement (candidate)" });
      } else if (control.required) {
        askable.push({ id: questionId(control), label: cleanLabel(control), canonicalKey: null, kind: "agree", options: ["I agree"], required: true });
      }
      continue;
    }

    if (classification.sensitive || classification.attestation) {
      if (control.required) blockers.push(observed);
      continue;
    }

    // The candidate's answer for this exact question wins; otherwise a saved canonical answer.
    const oneTime = input.oneTimeAnswers?.[questionId(control)];
    const saved =
      classification.key && classification.reusePolicy === "auto"
        ? applyAnswer(profile, classification.key)
        : null;
    const answer = oneTime !== undefined && oneTime !== "" ? oneTime : saved;
    if (answer === null || answer === undefined || String(answer).trim() === "") {
      if (control.required) {
        const question = await askableQuestion(form, control, classification.key);
        if (question) askable.push(question);
        else blockers.push(observed);
      }
      continue;
    }

    const locator = form.locator(APPLICATION_CONTROL_SELECTOR).nth(control.index);

    if (control.yesNoButtons) {
      const yes = typeof answer === "boolean" ? answer : /^(yes|y|true)\b/i.test(String(answer));
      const no = typeof answer === "boolean" ? !answer : /^(no|n|false)\b/i.test(String(answer));
      if (!yes && !no) {
        if (control.required) {
          const question = await askableQuestion(form, control, classification.key);
          if (question) askable.push(question);
        }
        continue;
      }
      await locator.locator("xpath=..").getByRole("button", { name: yes ? "Yes" : "No", exact: true }).click();
      filled.push({ label: cleanLabel(control), key: classification.key });
      continue;
    }

    if (control.role === "combobox") {
      await locator.click();
      const options = page.locator('[role="option"]:visible');
      const count = await options.count();
      let selected = false;
      for (let optionIndex = 0; optionIndex < count; optionIndex++) {
        const option = options.nth(optionIndex);
        const label = (await option.innerText().catch(() => "")).trim();
        if (
          (typeof answer === "boolean" && truthyChoice(answer, label)) ||
          (typeof answer !== "boolean" &&
            (normalize(label) === normalize(answer) ||
              normalize(label).includes(normalize(answer))))
        ) {
          await option.click();
          selected = true;
          filled.push({ label: cleanLabel(control), key: classification.key });
          break;
        }
      }
      if (!selected && control.required) blockers.push(observed);
      if (!selected) await page.keyboard.press("Escape").catch(() => undefined);
      continue;
    }

    if (control.tag === "select") {
      const option = optionForAnswer(control, answer);
      if (!option) {
        if (control.required) blockers.push(observed);
        continue;
      }
      await locator.selectOption(option.value).catch(async () => {
        await locator.selectOption({ label: option.label });
      });
      filled.push({ label: cleanLabel(control), key: classification.key });
      continue;
    }

    if (control.type === "radio") {
      const radios = form.locator(`input[type="radio"][name="${control.name.replace(/"/g, '\\"')}"]`);
      const count = await radios.count();
      let selected = false;
      for (let radioIndex = 0; radioIndex < count; radioIndex++) {
        const radio = radios.nth(radioIndex);
        const value = await radio.getAttribute("value");
        const id = (await radio.getAttribute("id")) || "";
        const label = id
          ? await form.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).innerText().catch(() => "")
          : "";
        const choice = label || value || "";
        const matches =
          typeof answer === "boolean"
            ? truthyChoice(answer, choice)
            : normalize(choice) === normalize(answer) || normalize(choice).includes(normalize(answer));
        if (matches) {
          await radio.check();
          selected = true;
          filled.push({ label: cleanLabel(control), key: classification.key });
          break;
        }
      }
      if (!selected && control.required) blockers.push(observed);
      continue;
    }

    if (control.type === "checkbox") {
      if (control.required) blockers.push(observed);
      continue;
    }

    const value =
      typeof answer === "boolean" ? (answer ? "Yes" : "No") : String(answer);
    await locator.fill(value);
    filled.push({ label: cleanLabel(control), key: classification.key });
  }

  return { form, observedQuestions, blockers, askable, filled };
}

async function clickNextAction(form: any) {
  const buttons = form.locator(
    'button:visible,input[type="submit"]:visible,input[type="button"]:visible,a:visible',
  );
  const count = await buttons.count();
  const candidates: Array<{ index: number; text: string; final: boolean; score: number }> = [];
  for (let index = 0; index < count; index++) {
    const button = buttons.nth(index);
    const text = normalize(
      (await button.innerText().catch(() => "")) ||
        (await button.getAttribute("value")) ||
        (await button.getAttribute("aria-label")) ||
        "",
    );
    if (!text) continue;
    let score = 0;
    let final = false;
    if (/submit application|submit$|apply now|finish application/.test(text)) {
      score += 20;
      final = true;
    }
    if (/continue|next|save and continue|proceed/.test(text)) score += 15;
    if (/search|back|cancel|save job|share/.test(text)) score -= 20;
    candidates.push({ index, text, final, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];
  if (!winner || winner.score <= 0) return null;
  return { locator: buttons.nth(winner.index), final: winner.final, text: winner.text };
}

async function driveApplication(
  browser: any,
  page: any,
  input: ApplicationAgentRunInput,
  observedQuestions: ObservedQuestion[],
): Promise<ApplicationAgentRunResult> {
  let currentUrl = page.url();
  for (let step = 0; step < 8; step++) {
    await page.waitForTimeout(500);
    currentUrl = page.url();

    if (!allowedApplyNavigation(input.provider, currentUrl, input.applicationUrl)) {
      return createHandoff(
        page,
        "external_navigation",
        "The employer application moved to a site CareJoys does not recognize. Review the page and continue manually.",
        observedQuestions,
      );
    }

    if (await successDetected(page)) {
      await browser.close();
      return { status: "submitted", currentUrl, observedQuestions };
    }

    const captcha = await captchaDetected(page);

    const filled = await fillApplicationStep(page, input);
    for (const q of [...filled.observedQuestions, ...filled.blockers]) {
      if (!observedQuestions.some((e) => e.text === q.text && e.canonicalKey === q.canonicalKey)) observedQuestions.push(q);
    }

    // Anything CareJoys cannot ask itself (attestation, sensitive, login, unusual widget) needs the candidate in the live browser.
    if (filled.blockers.length) {
      const descriptions = filled.blockers
        .slice(0, 3)
        .map((blocker) => blocker.text.replace(/\s+/g, " ").trim().slice(0, 150))
        .filter(Boolean);
      return createHandoff(
        page,
        "candidate_input_required",
        descriptions.length
          ? "Please answer the remaining employer question(s): " + descriptions.join(" · ")
          : "Please review and answer the remaining required employer question(s), then finish the application.",
        observedQuestions,
      );
    }

    // Plain missing answers: pause with the browser alive and let CareJoys ask for them.
    if (filled.askable.length) {
      return {
        status: "needs_answers",
        currentUrl,
        browserSessionId: String(browser.sessionId?.() || ""),
        questions: filled.askable.slice(0, 12),
        observedQuestions,
      };
    }

    // Everything CareJoys can do is done; the employer's human check needs the candidate.
    if (captcha) {
      return createHandoff(
        page,
        "captcha",
        "Your application is filled in. Please tick the employer's \"I'm not a robot\" check, then press Submit.",
        observedQuestions,
      );
    }

    const action = await clickNextAction(filled.form);
    if (!action) {
      if (await successDetected(page)) {
        await browser.close();
        return { status: "submitted", currentUrl: page.url(), observedQuestions };
      }
      return createHandoff(
        page,
        "unrecognized_step",
        "CareJoys filled the answers it safely knows, but could not identify the employer's next action. Review this step and finish the application.",
        observedQuestions,
      );
    }

    if (action.final) {
      const formText = await filled.form.innerText().catch(() => "");
      const pageFlags = isSensitiveOrAttestation(formText);
      if (pageFlags.attestation) {
        return createHandoff(
          page,
          "legal_attestation",
          "The employer requires a certification, acknowledgment, or signature before final submission. Please review and submit it yourself.",
          observedQuestions,
        );
      }
    }

    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => undefined),
      action.locator.click(),
    ]);
  }

  return createHandoff(
    page,
    "step_limit",
    "This employer application has more steps than CareJoys can safely automate. Review the remaining steps and finish the application.",
    observedQuestions,
  );
}

export async function runApplicationAgent(
  browserBinding: BrowserWorker,
  input: ApplicationAgentRunInput,
): Promise<ApplicationAgentRunResult> {
  const observedQuestions: ObservedQuestion[] = [];
  let browser: any = null;
  try {
    browser = await launch(browserBinding, { keep_alive: APPLICATION_PAUSE_MS });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(input.applicationUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    return await driveApplication(browser, page, input, observedQuestions);
  } catch (error) {
    if (browser) await browser.close().catch(() => undefined);
    return {
      status: "failed",
      currentUrl: input.applicationUrl,
      error: error instanceof Error ? error.message : String(error),
      observedQuestions,
    };
  }
}

// Reconnects to the paused browser and carries on with the candidate's new answers.
export async function continueApplicationAgent(
  browserBinding: BrowserWorker,
  browserSessionId: string,
  input: ApplicationAgentRunInput,
): Promise<ApplicationAgentRunResult | { status: "expired" }> {
  const observedQuestions: ObservedQuestion[] = [];
  let browser: any = null;
  try {
    browser = await connect(browserBinding, browserSessionId);
  } catch {
    return { status: "expired" };
  }
  try {
    const page = browser.contexts()[0]?.pages()[0];
    if (!page) {
      await browser.close().catch(() => undefined);
      return { status: "expired" };
    }
    return await driveApplication(browser, page, input, observedQuestions);
  } catch (error) {
    await browser.close().catch(() => undefined);
    return {
      status: "failed",
      currentUrl: input.applicationUrl,
      error: error instanceof Error ? error.message : String(error),
      observedQuestions,
    };
  }
}

export interface FillTestResult {
  ok: boolean;
  currentUrl: string;
  filled: Array<{ label: string; key: string | null }>;
  wouldAsk: PendingQuestion[];
  needsCandidateInBrowser: Array<{ text: string; canonicalKey: string | null }>;
  nextAction: string | null;
  nextIsFinalSubmit: boolean;
  captcha: boolean;
  screenshotJpeg: string | null; // base64
  error?: string;
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Live test on a real listing: fills page one with a test profile, then stops. Never clicks
// Next/Submit and never attaches files, so nothing reaches the employer.
export async function testFillApplication(
  browserBinding: BrowserWorker,
  input: ApplicationAgentRunInput,
): Promise<FillTestResult> {
  let browser: any = null;
  try {
    browser = await launch(browserBinding);
    const page = await (await browser.newContext()).newPage();
    await page.goto(input.applicationUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);
    const captcha = await captchaDetected(page);
    const step = await fillApplicationStep(page, { ...input, skipFileUpload: true });
    const action = await clickNextAction(step.form);
    await step.form.scrollIntoViewIfNeeded?.().catch(() => undefined);
    const shot = await page.screenshot({ fullPage: true, type: "jpeg", quality: 55 }).catch(() => null);
    const result: FillTestResult = {
      ok: true,
      currentUrl: page.url(),
      filled: step.filled,
      wouldAsk: step.askable,
      needsCandidateInBrowser: step.blockers.map((b) => ({ text: b.text.slice(0, 200), canonicalKey: b.canonicalKey })),
      nextAction: action?.text || null,
      nextIsFinalSubmit: Boolean(action?.final),
      captcha,
      screenshotJpeg: shot && shot.byteLength < 4_000_000 ? base64(new Uint8Array(shot)) : null,
    };
    await browser.close();
    return result;
  } catch (error) {
    if (browser) await browser.close().catch(() => undefined);
    return {
      ok: false, currentUrl: input.applicationUrl, filled: [], wouldAsk: [], needsCandidateInBrowser: [],
      nextAction: null, nextIsFinalSubmit: false, captcha: false, screenshotJpeg: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
