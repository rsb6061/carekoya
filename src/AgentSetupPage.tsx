import { useState } from 'react';
import { SiteFooter, SiteHeader } from './SiteChrome';
import './styles.css';

const SERVER_URL='https://carejoys.com/api/mcp';

// Public setup page for the CareJoys MCP server (Claude and ChatGPT).
export function AgentSetupPage(){
  const [copied,setCopied]=useState(false);
  async function copy(){
    try{await navigator.clipboard.writeText(SERVER_URL);setCopied(true);setTimeout(()=>setCopied(false),2000)}catch{}
  }
  return <div>
    <SiteHeader/>
    <main>
      <section className="hero"><div className="wrap">
        <div className="modal-kicker">For Claude and ChatGPT</div>
        <h1>Find caregiver jobs from your AI assistant.</h1>
        <p>Add CareJoys to Claude or ChatGPT to search current CNA, GNA, HHA, PCA and caregiver jobs at home-care agencies, and send your profile to the ones you pick.</p>
        <div className="jobcta"><div><strong>Server URL</strong><span><code>{SERVER_URL}</code></span></div><button className="btn secondary" onClick={copy}>{copied?'Copied':'Copy URL'}</button></div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>Set it up</h2>
        <div className="jobs">
          <div className="job"><div><h3>Claude</h3><div className="meta">Open Settings, then Connectors, and choose Add custom connector. Name it CareJoys, paste the server URL, and save. No sign-in is needed.</div></div></div>
          <div className="job"><div><h3>ChatGPT</h3><div className="meta">Open Settings, then Apps and Connectors, turn on developer mode if asked, and create a connector with the server URL. No sign-in is needed.</div></div></div>
          <div className="job"><div><h3>Then ask</h3><div className="meta">“Find CNA jobs near 21201 that pay at least $19 an hour, and send my profile to the two best ones.”</div></div></div>
        </div>
      </div></section>

      <section className="section"><div className="wrap">
        <h2>What your assistant can and can’t do</h2>
        <div className="jobs">
          <div className="job"><div><h3>Search jobs and agencies</h3><div className="meta">Jobs come from each agency’s own careers page, with the date CareJoys last checked them. Coverage grows as CareJoys checks agencies in more states; search by city or ZIP.</div></div></div>
          <div className="job"><div><h3>Prepare to send your profile</h3><div className="meta">Your assistant collects your name, email, ZIP and role and shows you a summary first.</div></div></div>
          <div className="job"><div><h3>You press Send</h3><div className="meta">CareJoys emails you a link. No agency sees anything until you open it and press Send. The assistant can then check whether each agency has reached out.</div></div></div>
        </div>
      </div></section>
    </main>
    <SiteFooter/>
  </div>;
}
