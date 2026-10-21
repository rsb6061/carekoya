// Kept apart from seo.ts so job scanning (sourcingPriorities.ts) can use the same places without importing the SEO pages.

/**
 * Big cities whose jobs are mostly posted under suburb names ("Towson", "Parkville") get one metro page at the
 * city's slug that rolls those places up. ZIP prefixes keep a mislabeled out-of-area job from joining.
 */
export type Metro={state:string;slug:string;name:string;area:string;zipPrefixes:string[];places:string[]};
export const METROS:Metro[]=[
  {state:'MD',slug:'baltimore',name:'Baltimore',area:'Baltimore City and Baltimore County',zipPrefixes:['210','211','212'],places:[
    'Baltimore','Baltimore City','Baltimore County','Towson','Parkville','Rosedale','Pikesville','Owings Mills','Cockeysville',
    'Lutherville','Lutherville-Timonium','Lutherville Timonium','Timonium','Hunt Valley','Phoenix','Monkton','Sparks','Glen Arm',
    'Kingsville','Perry Hall','Nottingham','White Marsh','Middle River','Essex','Dundalk','Catonsville','Arbutus','Halethorpe',
    'Lansdowne','Woodlawn','Windsor Mill','Gwynn Oak','Randallstown','Reisterstown','Glyndon','Brooklyn Park','Brooklyn Pk','Woodstock']},
  {state:'MI',slug:'detroit',name:'Detroit',area:'Wayne, Oakland and Macomb counties',zipPrefixes:['480','481','482','483'],places:[
    'Detroit','Dearborn','Dearborn Heights','Southfield','Bloomfield Township','Bloomfield Hills','West Bloomfield','Birmingham',
    'Bingham Farms','Farmington','Farmington Hills','Livonia','Novi','Northville','Plymouth','Canton','Westland','Garden City',
    'Redford Township','Taylor','Southgate','Southagate','Wyandotte','Riverview','Belleville','New Boston','Romulus','Troy',
    'Rochester','Rochester Hills','Auburn Hills','Pontiac','Waterford','Clarkston','Lake Orion','Oxford','Commerce Township',
    'Wixom','Milford','Royal Oak','Ferndale','Madison Heights','Warren','Sterling Heights','Clinton Township','Macomb',
    'Shelby Township','Grosse Pointe']},
  {state:'TX',slug:'houston',name:'Houston',area:'Houston, Sugar Land, Katy and the surrounding suburbs',zipPrefixes:['770','772','773','774','775'],places:[
    'Houston','Sugar Land','Katy','Humble','Kingwood','Conroe','The Woodlands','Spring','Cypress','Tomball','Pearland','Friendswood',
    'League City','Webster','Seabrook','Pasadena','Baytown','Missouri City','Stafford','Richmond','Rosenberg','Bellaire','Arcola']},
  {state:'TX',slug:'dallas',name:'Dallas',area:'Dallas and its suburbs',zipPrefixes:['750','751','752','753'],places:[
    'Dallas','East Dallas','Lake Highlands','Garland','Mesquite','Irving','Plano','Richardson','Carrollton','Farmers Branch','Addison',
    'Desoto','DeSoto','Cedar Hill','Duncanville','Grand Prairie','Mckinney','McKinney','Frisco','Allen','Rowlett','Rockwall','Sunnyvale',
    'Forney','Coppell','Lewisville','Flower Mound','Highland Village','Little Elm']},
  {state:'NC',slug:'raleigh',name:'Raleigh',area:'Raleigh and Wake and Johnston counties',zipPrefixes:['275','276'],places:[
    'Raleigh','Cary','Garner','Clayton','Apex','Wake Forest','Knightdale','Wendell','Zebulon','Fuquay-Varina','Holly Springs','Morrisville','Smithfield']},
  {state:'MA',slug:'boston',name:'Boston',area:'Boston and its inner suburbs',zipPrefixes:['020','021','022','024'],places:[
    'Boston','Allston','Brighton','Hyde Park','South Boston','Mattapan','Dorchester','Roxbury','Jamaica Plain','Roslindale',
    'West Roxbury','Charlestown','East Boston','Cambridge','Somerville','Brookline','Newton','Waltham','Watertown','Belmont',
    'Arlington','Lexington','Quincy','Milton','Dedham','Norwood','Needham','Wellesley','Randolph','Braintree','Weymouth',
    'Canton','Walpole','Malden','Medford','Everett','Chelsea','Revere','Winchester','Woburn','Burlington']},
  {state:'NV',slug:'las-vegas',name:'Las Vegas',area:'Las Vegas, Henderson and North Las Vegas',zipPrefixes:['889','890','891'],places:[
    'Las Vegas','Henderson','North Las Vegas','N Las Vegas','Paradise','Spring Valley','Enterprise','Summerlin','Whitney','Sunrise Manor','Boulder City']},
  {state:'NY',slug:'new-york',name:'New York City',area:'all five boroughs',zipPrefixes:['100','101','102','103','104','110','111','112','113','114','116'],places:[
    'New York','New York City','NYC','Manhattan','Brooklyn','Bronx','The Bronx','Queens','Staten Island','Flushing','Jamaica','Astoria',
    'Long Island City','Forest Hills','Jackson Heights','Elmhurst','Corona','Ozone Park','Richmond Hill','Far Rockaway','Bayside','Fresh Meadows','Rego Park','Woodside']},
  {state:'CA',slug:'los-angeles',name:'Los Angeles',area:'Los Angeles and nearby cities in LA County',zipPrefixes:['900','901','902','903','904','905','906','907','908','910','911','912','913','914','915','916','917','918'],places:[
    'Los Angeles','Long Beach','Pasadena','Glendale','Torrance','Burbank','Santa Monica','Inglewood','Culver City','Downey','Norwalk','Whittier',
    'West Covina','El Monte','Alhambra','Pomona','Gardena','Carson','Compton','Lakewood','Van Nuys','North Hollywood','Sherman Oaks','Encino',
    'Northridge','Reseda','Woodland Hills','Canoga Park','Tarzana','Studio City','Hollywood','West Hollywood','Beverly Hills']}
];
