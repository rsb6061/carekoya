import { useEffect, useRef, useState } from 'react';

declare global { interface Window { CareJoysJobs?: { render: () => void } } }

// Copy-paste embed that shows this agency's CareJoys jobs on its own website, with a live preview.
export function JobsWidgetCard({agencyId}:{agencyId:string}){
  const [copied,setCopied]=useState(false);
  const preview=useRef<HTMLDivElement>(null);
  const snippet=`<div data-carejoys-jobs="${agencyId}"></div>\n<script src="https://carejoys.com/widget.js" async></script>`;
  useEffect(()=>{
    const box=preview.current;
    if(!box)return;
    box.innerHTML='';
    const el=document.createElement('div');
    el.setAttribute('data-carejoys-jobs',agencyId);
    box.appendChild(el);
    if(window.CareJoysJobs){window.CareJoysJobs.render();return}
    const s=document.createElement('script');
    s.src='/widget.js';s.async=true;
    document.body.appendChild(s);
  },[agencyId]);
  async function copy(){
    try{await navigator.clipboard.writeText(snippet);setCopied(true);setTimeout(()=>setCopied(false),2000)}catch{setCopied(false)}
  }
  return <div className="widget-card settings-card">
    <div className="widget-card-head">
      <div><h3>Show these jobs on your website</h3>
        <p>Paste this where your careers page lists openings. It stays in sync with the jobs below, and caregivers who apply through it land in your Inbox here.</p></div>
      <button className="button" type="button" onClick={copy}>{copied?'Copied ✓':'Copy code'}</button>
    </div>
    <pre className="widget-snippet"><code>{snippet}</code></pre>
    <div className="widget-preview-label">Preview</div>
    <div className="widget-preview" ref={preview}/>
  </div>;
}
