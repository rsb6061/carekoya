import './styles.css';

type Kind='privacy'|'terms';

const updated='September 25, 2026';

export function LegalPage({kind}:{kind:Kind}){
  const privacy=kind==='privacy';
  return <div>
    <header className="nav"><div className="wrap nav-inner"><a className="brand" href="/">CareJoys</a><nav className="navlinks"><a href="/privacy-policy">Privacy</a><a href="/terms-of-service">Terms</a><a id="nav-primary" href="/app">Employer workspace</a></nav></div></header>
    <main className="legal-shell"><div className="wrap legal-wrap">
      <div className="legal-kicker">CareJoys</div>
      <h1>{privacy?'Privacy Policy':'Terms of Service'}</h1>
      <p className="legal-updated">Last updated: {updated}</p>
      {privacy?<Privacy/>:<Terms/>}
    </div></main>
    <footer className="footer"><div className="wrap">CareJoys · <a href="/privacy-policy">Privacy Policy</a> · <a href="/terms-of-service">Terms of Service</a></div></footer>
  </div>;
}

function Privacy(){
  return <div className="legal-content">
    <section><h2>1. What CareJoys is</h2><p>CareJoys is a recruiting and workforce-matching platform for caregivers and care employers. We help caregivers create work profiles, help employers identify potential candidates, and support recruiting steps such as interest confirmation and interview scheduling.</p></section>
    <section><h2>2. Information we collect</h2><p>We collect information you provide to us, including name, contact information, location, work role, credentials or specialties, experience, shift and pay preferences, transportation or commute information, employer hiring needs, interview availability, and communications or responses made through CareJoys. We also collect basic technical information needed to operate and secure the service, such as IP-derived security signals, timestamps, session information, and request logs.</p></section>
    <section><h2>3. Caregiver profile visibility</h2><p>Caregiver work-profile information may be shown to participating care employers for recruiting purposes. This can include your public name, general location, role, experience, credentials, specialties, work preferences, commute information, and availability status. We do not treat an older profile as proof that you are currently job seeking; when availability has not been recently confirmed, CareJoys labels it as unconfirmed. If you tell us you are not looking, we remove your profile from employer search and matching.</p></section>
    <section><h2>4. How we use information</h2><p>We use information to operate CareJoys, match caregivers with hiring needs, rank and surface relevant candidates, send recruiting or account communications, confirm interest and availability, schedule interviews, prevent fraud and abuse, improve the service, and comply with legal obligations.</p></section>
    <section><h2>5. How we share information</h2><p>We share relevant caregiver profile information with care employers using CareJoys for recruiting. We may share information with service providers that help us host, secure, communicate, or operate the platform. We may also disclose information when required by law or to protect the rights, safety, and security of CareJoys, our users, or others. We do not sell personal information to advertisers.</p></section>
    <section><h2>6. Communications</h2><p>We may email you about account access, profile activity, relevant jobs, interview scheduling, or service updates. We send SMS recruiting messages only when you provide SMS consent. Message and data rates may apply, and SMS users can reply STOP to opt out.</p></section>
    <section><h2>7. Data choices and retention</h2><p>You may ask us to access, correct, or delete information associated with your profile, subject to legal and operational retention requirements. You may update your current availability through CareJoys communications. We retain information for as long as reasonably necessary to provide the service, protect the platform, resolve disputes, and meet legal obligations.</p></section>
    <section><h2>8. Security</h2><p>We use reasonable administrative and technical safeguards, including protected employer sessions, one-time sign-in links, hashed authentication tokens, rate limiting, and service-provider security controls. No online service can guarantee absolute security.</p></section>
    <section><h2>9. Contact</h2><p>Questions or privacy requests can be sent to <a href="mailto:privacy@carejoys.com">privacy@carejoys.com</a>.</p></section>
  </div>;
}

function Terms(){
  return <div className="legal-content">
    <section><h2>1. Acceptance</h2><p>By using CareJoys, you agree to these Terms and our Privacy Policy. If you do not agree, do not use the service.</p></section>
    <section><h2>2. Platform role</h2><p>CareJoys provides recruiting, matching, communication, and interview-scheduling tools. CareJoys is not the employer of caregivers introduced through the platform and does not make hiring decisions for care employers. Employers are responsible for their own hiring decisions, employment terms, credential checks, background checks, licensing requirements, workplace obligations, and compliance with applicable law.</p></section>
    <section><h2>3. User responsibilities</h2><p>You must provide accurate information and use CareJoys only for lawful recruiting or job-seeking purposes. Employers may not misuse caregiver data, scrape the service, discriminate unlawfully, send abusive communications, or use CareJoys for unrelated solicitation. Caregivers should keep work-profile and availability information reasonably current.</p></section>
    <section><h2>4. Profiles, matching, and availability</h2><p>CareJoys may rank or match profiles using information such as role, location, credentials, preferences, commute, responsiveness, and recency of availability confirmation. A match score or profile does not guarantee suitability, availability, employment, performance, credentials, or hiring outcome. Profiles with older availability may remain discoverable while clearly labeled as unconfirmed.</p></section>
    <section><h2>5. Interviews and communications</h2><p>CareJoys may send account, recruiting, job-interest, and interview communications on behalf of users. Interview times booked through CareJoys are scheduling tools only; employers remain responsible for confirming interview format, location, and any employment-related requirements.</p></section>
    <section><h2>6. No guarantee</h2><p>CareJoys does not guarantee that an employer will hire a candidate, that a caregiver will respond or remain available, or that information supplied by a user is complete or accurate. The service is provided on an “as is” and “as available” basis to the extent permitted by law.</p></section>
    <section><h2>7. Suspension and termination</h2><p>We may restrict or terminate access for misuse, security risk, fraud, unlawful conduct, or violation of these Terms. Users may stop using CareJoys at any time and may request account or profile deletion subject to lawful retention requirements.</p></section>
    <section><h2>8. Changes</h2><p>We may update these Terms as the service evolves. Material changes will be reflected by updating the effective date and, when appropriate, by providing additional notice.</p></section>
    <section><h2>9. Contact</h2><p>Questions about these Terms can be sent to <a href="mailto:legal@carejoys.com">legal@carejoys.com</a>.</p></section>
  </div>;
}
