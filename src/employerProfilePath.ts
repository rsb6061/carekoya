// Shared by the Worker and the browser bundle, so it must stay free of server-only imports.
import { slugify } from './usStates';

/** An employer's public page: their name for people and search, then the start of the workspace id so the link is stable. */
export const employerProfilePath=(companyName:unknown,id:unknown)=>{
  const key=String(id||'').replace(/[^a-z0-9]/gi,'').slice(0,8).toLowerCase();
  return key?'/employers/'+(slugify(String(companyName||''))||'employer')+'-'+key:'';
};

/** The workspace id prefix at the end of an /employers/ slug, or '' when it has none. */
export const employerProfileKey=(slug:string)=>slug.match(/-([a-z0-9]{8})$/i)?.[1].toLowerCase()||'';
