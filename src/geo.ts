type Row=Record<string,unknown>;
type Statement={bind(...values:unknown[]):Statement;first<T=Row>():Promise<T|null>};
type DB={prepare(query:string):Statement};

export type ZipGeo={zip:string;lat:number;lng:number;city:string;state:string};

export const DEFAULT_COMMUTE_MILES=25;
export const MAX_SEARCH_MILES=100;

const EARTH_RADIUS_MILES=3958.8;
const toRad=(deg:number)=>deg*Math.PI/180;

export function normalizeZip(value:unknown){
  const match=String(value??'').trim().match(/^(\d{5})/);
  return match?match[1]:'';
}

export function haversineMiles(a:{lat:number;lng:number},b:{lat:number;lng:number}){
  const dLat=toRad(b.lat-a.lat);
  const dLng=toRad(b.lng-a.lng);
  const h=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2*EARTH_RADIUS_MILES*Math.asin(Math.min(1,Math.sqrt(h)));
}

/** Lat/lng box that contains every point within `miles` of the center; use it as a SQL prefilter before haversine. */
export function boundingBox(center:{lat:number;lng:number},miles:number){
  const dLat=miles/69;
  const dLng=miles/(69*Math.max(0.01,Math.cos(toRad(center.lat))));
  return {minLat:center.lat-dLat,maxLat:center.lat+dLat,minLng:center.lng-dLng,maxLng:center.lng+dLng};
}

/** Reads `geo_lat`/`geo_lng` columns produced by `LEFT JOIN zip_geo`. */
export function rowGeo(row:Row){
  const lat=Number(row.geo_lat),lng=Number(row.geo_lng);
  return row.geo_lat!=null&&row.geo_lng!=null&&Number.isFinite(lat)&&Number.isFinite(lng)?{lat,lng}:null;
}

export function rowDistanceMiles(a:Row,b:Row){
  const ga=rowGeo(a),gb=rowGeo(b);
  return ga&&gb?haversineMiles(ga,gb):null;
}

/** Maryland ZIP prefixes (206-219); only used when zip_geo has no row for the ZIP. */
export function fallbackStateForZip(zip:string){
  return /^2(?:0[6-9]|1\d)/.test(zip)?'MD':'';
}

export async function lookupZip(db:DB|undefined,value:unknown):Promise<ZipGeo|null>{
  const zip=normalizeZip(value);
  if(!db||!zip)return null;
  try{
    const row=await db.prepare('SELECT zip,lat,lng,city,state FROM zip_geo WHERE zip=? LIMIT 1').bind(zip).first<Row>();
    if(!row)return null;
    return {zip,lat:Number(row.lat),lng:Number(row.lng),city:String(row.city||''),state:String(row.state||'')};
  }catch{return null}
}

export async function stateForZip(db:DB|undefined,value:unknown){
  const geo=await lookupZip(db,value);
  return geo?.state||fallbackStateForZip(normalizeZip(value));
}

/** SQL fragment joining zip_geo onto a table alias that has a `zip` column. */
export const zipGeoJoin=(alias:string,geoAlias='zg')=>`LEFT JOIN zip_geo ${geoAlias} ON ${geoAlias}.zip=substr(trim(COALESCE(${alias}.zip,'')),1,5)`;
