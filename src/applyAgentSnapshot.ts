// Reads an application page's fields: the question each belongs to, whether it's required, and
// its options. Shared by the application agent and live read-only tests.
// Runs inside the page (Playwright serializes it), so it must not reference anything outside itself.
export function snapshotElements(elements: Element[]) {
      const FIELD = 'input:not([type="hidden"]),select,textarea';
      const clean = (t: string | null | undefined) => String(t || "").replace(/\s+/g, " ").trim();
      const machineName = (t: string) => /^[0-9a-f-]{20,}$/i.test(t) || /^_systemfield_/.test(t);
      // The question a field belongs to: the label/legend in the nearest container that holds only
      // this field (or only this radio/checkbox group). Handles labels not tied with for=.
      const questionOf = (input: HTMLInputElement) => {
        let node = input.parentElement;
        for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
          const fields = Array.from(node.querySelectorAll(FIELD)) as HTMLInputElement[];
          const own =
            input.type === "radio" || input.type === "checkbox"
              ? fields.every((f) => f === input || (f.type === input.type && f.name && f.name === input.name))
              : fields.length === 1;
          if (!own) break;
          // Legends and labels first, then label-/question-styled elements; never descriptions.
          const candidates = [
            ...Array.from(node.querySelectorAll("legend")),
            ...Array.from(node.querySelectorAll("label")),
            ...Array.from(node.querySelectorAll("[class*='label' i],[class*='question' i]")),
          ];
          const candidate = candidates.find((el) => {
            if (el.querySelector(FIELD) || !clean(el.textContent)) return false;
            if (/description|helper|hint/i.test(String((el as HTMLElement).className || ""))) return false;
            const forId = (el as HTMLLabelElement).htmlFor;
            const target = forId ? (document.getElementById(forId) as HTMLInputElement | null) : null;
            // Skip the labels of individual options ("Male", "Yes"); a lone checkbox's own label is its question.
            if (target && target.type === "radio") return false;
            if (target && target.type === "checkbox" && target !== input) return false;
            return true;
          });
          if (candidate) return candidate as HTMLElement;
        }
        return null;
      };
      return elements.map((element, index) => {
        const input = element as HTMLInputElement;
        const id = input.id || "";
        const explicitEl = id ? (document.querySelector(`label[for="${CSS.escape(id)}"]`) as HTMLElement | null) : null;
        const explicit = clean(explicitEl?.textContent);
        const wrapping = clean(input.closest("label")?.textContent);
        const parentText = clean(input.parentElement?.textContent || input.closest("fieldset")?.textContent);
        const aria = clean(input.getAttribute("aria-label"));
        const labelledBy = input.getAttribute("aria-labelledby") || "";
        const labelledText = clean(labelledBy.split(/\s+/).map((labelId) => document.getElementById(labelId)?.textContent || "").join(" "));
        const placeholder = clean(input.getAttribute("placeholder"));
        const legend = clean(input.closest("fieldset")?.querySelector("legend")?.textContent);
        const name = input.getAttribute("name") || "";
        const questionEl = questionOf(input);
        const question = clean(questionEl?.textContent);
        const isChoice = input.type === "radio" || input.type === "checkbox";
        const markedRequired = (el: Element | null | undefined) =>
          Boolean(el && (/\*|\(required\)|\brequired\b/i.test(el.textContent || "") || /required/i.test(String((el as HTMLElement).className || ""))));
        const required =
          input.hasAttribute("required") ||
          input.getAttribute("aria-required") === "true" ||
          markedRequired(explicitEl) || markedRequired(questionEl) ||
          /\brequired\b|\*/i.test(wrapping);
        const options = input instanceof HTMLSelectElement
          ? Array.from((input as unknown as HTMLSelectElement).options).map((option) => ({ value: option.value, label: option.textContent || option.label || "" }))
          : [];
        const buttonTexts = input.type === "checkbox" && input.parentElement
          ? Array.from(input.parentElement.querySelectorAll("button")).map((b) => clean(b.textContent).toLowerCase())
          : [];
        // Radio groups: the fieldset legend is the question ("Race"), not an option's text.
      const labelParts = isChoice
          ? [legend, question, labelledText, aria, explicit, wrapping]
          : [explicit, aria, labelledText, question, legend, wrapping, placeholder];
        return {
          index,
          tag: input.tagName.toLowerCase(),
          role: (input.getAttribute("role") || "").toLowerCase(),
          type: (input.getAttribute("type") || "").toLowerCase(),
          name,
          id,
          text: [question, explicit, wrapping, aria, labelledText, placeholder, machineName(name) ? "" : name, parentText]
            .filter(Boolean).join(" ").replace(/\*/g, "").slice(0, 800),
          label: labelParts.map((part) => part.replace(/\s*\*\s*$/, "").replace(/\s*\(required\)\s*$/i, "")).find((part) => part.length >= 2) ||
            (machineName(name) ? "" : name),
          required,
          visible: (() => { const r = input.getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
          // Already answered on the page (a preset Country, a checked radio): leave it alone.
          hasValue: input.type === "radio"
            ? Boolean(input.name && document.querySelector(`input[type="radio"][name="${CSS.escape(input.name)}"]:checked`))
            : input.type === "checkbox" || input.type === "file"
              ? false
              : input.tagName === "SELECT"
                ? Boolean((input as unknown as HTMLSelectElement).value) && !/^(select|choose|--|please)/i.test(clean((input as unknown as HTMLSelectElement).selectedOptions?.[0]?.textContent))
                : clean(input.value).length > 0,
          yesNoButtons: buttonTexts.includes("yes") && buttonTexts.includes("no"),
          options,
        };
      });
}
