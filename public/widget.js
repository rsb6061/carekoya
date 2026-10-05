/* CareJoys jobs widget: shows a claimed agency's current caregiver jobs on the agency's own website.
   <div data-carejoys-jobs="AGENCY_ID"></div><script src="https://carejoys.com/widget.js" async></script>
   Optional attributes on the div: data-color="#4255ff" (button color), data-heading="Join our team". */
(function(){
  var script=document.currentScript;
  var origin=script&&script.src?new URL(script.src).origin:'https://carejoys.com';
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
  var safeColor=function(v){return /^#[0-9a-f]{3,8}$/i.test(v||'')?v:'#4255ff'};
  var css=':host{all:initial;display:block;font-family:inherit;color:inherit}'+
    '.cj{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1b153c;line-height:1.4}'+
    '.cj h3{font-size:20px;margin:0 0 12px;font-weight:650}'+
    '.cj-list{display:grid;gap:10px}'+
    '.cj-job{display:flex;align-items:center;justify-content:space-between;gap:14px;border:1px solid #e3e0ef;border-radius:14px;padding:14px 16px;background:#fff}'+
    '.cj-title{font-size:16px;font-weight:600;margin:0 0 3px}'+
    '.cj-meta{font-size:13px;color:#6e6882}'+
    '.cj-btn{flex:none;display:inline-block;background:var(--cj-color);color:#fff;text-decoration:none;font-size:14px;font-weight:600;border-radius:999px;padding:9px 18px}'+
    '.cj-btn:hover{filter:brightness(.93)}'+
    '.cj-empty{font-size:14px;color:#6e6882;border:1px dashed #e3e0ef;border-radius:14px;padding:16px}'+
    '.cj-foot{font-size:12px;color:#8a849c;margin-top:10px}.cj-foot a{color:inherit}'+
    '@media(max-width:520px){.cj-job{flex-direction:column;align-items:flex-start}}';
  function render(el){
    if(el.getAttribute('data-carejoys-ready'))return;
    el.setAttribute('data-carejoys-ready','1');
    var id=el.getAttribute('data-carejoys-jobs');
    var root=el.attachShadow?el.attachShadow({mode:'open'}):el;
    var heading=el.getAttribute('data-heading')||'Open caregiver jobs';
    root.innerHTML='<style>'+css+'</style><div class="cj" style="--cj-color:'+safeColor(el.getAttribute('data-color'))+'"><div class="cj-empty">Loading jobs…</div></div>';
    var box=root.querySelector('.cj');
    fetch(origin+'/api/public/agency-jobs/'+encodeURIComponent(id)).then(function(r){return r.json()}).then(function(d){
      if(!d||!d.ok){box.innerHTML='';return}
      var jobs=d.jobs||[];
      var list=jobs.map(function(j){
        var meta=[[j.city,j.state].filter(Boolean).join(', '),j.pay,j.employmentType].filter(Boolean).join(' · ');
        return '<div class="cj-job"><div><div class="cj-title">'+esc(j.title)+'</div><div class="cj-meta">'+esc(meta)+'</div></div>'+
          '<a class="cj-btn" href="'+esc(j.url)+'" target="_blank" rel="noopener">Apply</a></div>';
      }).join('');
      box.innerHTML='<h3>'+esc(heading)+'</h3>'+(jobs.length?'<div class="cj-list">'+list+'</div>':'<div class="cj-empty">No open positions right now. Check back soon.</div>')+
        '<div class="cj-foot">Apply in minutes with <a href="https://carejoys.com/?ref=widget" target="_blank" rel="noopener">CareJoys</a></div>';
    }).catch(function(){box.innerHTML=''});
  }
  function init(){var els=document.querySelectorAll('[data-carejoys-jobs]');for(var i=0;i<els.length;i++)render(els[i])}
  window.CareJoysJobs={render:init};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
