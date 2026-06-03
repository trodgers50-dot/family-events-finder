import { useState } from "react";

// ── Photo map by event type (Unsplash curated IDs) ───────────────────────────
const TYPE_PHOTOS = {
  Festival: [
    "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=600&q=80",
    "https://images.unsplash.com/photo-1506157786151-b8491531f063?w=600&q=80",
    "https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=600&q=80",
  ],
  Market: [
    "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=600&q=80",
    "https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&q=80",
    "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=600&q=80",
  ],
  Brewery: [
    "https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=600&q=80",
    "https://images.unsplash.com/photo-1566633806327-68e152aaf26d?w=600&q=80",
    "https://images.unsplash.com/photo-1473992243898-fa7525e652a5?w=600&q=80",
  ],
  Kids: [
    "https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=600&q=80",
    "https://images.unsplash.com/photo-1471286174890-9c112ffca5b4?w=600&q=80",
    "https://images.unsplash.com/photo-1566140967404-b8b3932483f5?w=600&q=80",
  ],
  Music: [
    "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=600&q=80",
    "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=600&q=80",
    "https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?w=600&q=80",
  ],
  Community: [
    "https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=600&q=80",
    "https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=600&q=80",
    "https://images.unsplash.com/photo-1544928147-79a2dbc1f389?w=600&q=80",
  ],
  Arts: [
    "https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=600&q=80",
    "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=600&q=80",
    "https://images.unsplash.com/photo-1537884944318-390069bb8665?w=600&q=80",
  ],
  Food: [
    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&q=80",
    "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=80",
    "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=600&q=80",
  ],
  Carnival: [
    "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&q=80",
    "https://images.unsplash.com/photo-1534768654272-e97681c3a2c7?w=600&q=80",
    "https://images.unsplash.com/photo-1562774053-701939374585?w=600&q=80",
  ],
  Family: [
    "https://images.unsplash.com/photo-1609220136736-443140cffec6?w=600&q=80",
    "https://images.unsplash.com/photo-1475503572774-15a45e5d60b9?w=600&q=80",
    "https://images.unsplash.com/photo-1536640712-4d4c36ff0e4e?w=600&q=80",
  ],
  Other: [
    "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=600&q=80",
    "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&q=80",
    "https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=600&q=80",
  ],
};

function getPhoto(type, id) {
  const photos = TYPE_PHOTOS[type] || TYPE_PHOTOS.Other;
  return photos[parseInt(id) % photos.length];
}

// ── Region detection ──────────────────────────────────────────────────────────
function getRegionInfo(zip) {
  const z = parseInt(zip);
  if (z>=20000&&z<=24699) return { city:"Virginia Beach", state:"VA", region:"VA", lat:36.8529, lng:-75.9780 };
  if (z>=10000&&z<=14999) return { city:"New York", state:"NY", region:"NY", lat:40.7128, lng:-74.0060 };
  if (z>=90000&&z<=96199) return { city:"Los Angeles", state:"CA", region:"CA", lat:34.0522, lng:-118.2437 };
  if (z>=75000&&z<=79999) return { city:"Houston", state:"TX", region:"TX", lat:29.7604, lng:-95.3698 };
  if (z>=32000&&z<=34999) return { city:"Miami", state:"FL", region:"FL", lat:25.7617, lng:-80.1918 };
  if (z>=60000&&z<=62999) return { city:"Chicago", state:"IL", region:"IL", lat:41.8781, lng:-87.6298 };
  if (z>=30000&&z<=31999) return { city:"Atlanta", state:"GA", region:"GA", lat:33.7490, lng:-84.3880 };
  if (z>=98000&&z<=98199) return { city:"Seattle", state:"WA", region:"WA", lat:47.6062, lng:-122.3321 };
  if (z>=80000&&z<=80299) return { city:"Denver", state:"CO", region:"CO", lat:39.7392, lng:-104.9903 };
  if (z>=85000&&z<=85099) return { city:"Phoenix", state:"AZ", region:"AZ", lat:33.4484, lng:-112.0740 };
  if (z>=37000&&z<=38599) return { city:"Nashville", state:"TN", region:"TN", lat:36.1627, lng:-86.7816 };
  if (z>=70000&&z<=71199) return { city:"New Orleans", state:"LA", region:"LA", lat:29.9511, lng:-90.0715 };
  if (z>=28200&&z<=28299) return { city:"Charlotte", state:"NC", region:"NC", lat:35.2271, lng:-80.8431 };
  if (z>=78200&&z<=78299) return { city:"San Antonio", state:"TX", region:"TX", lat:29.4241, lng:-98.4936 };
  if (z>=94100&&z<=94199) return { city:"San Francisco", state:"CA", region:"CA", lat:37.7749, lng:-122.4194 };
  return { city:"your area", state:"", region:"DEFAULT", lat:37.0902, lng:-95.7129 };
}

// Reverse geocode lat/lng to ZIP approximation
function latLngToRegion(lat, lng) {
  if (lat>=36&&lat<=37.5&&lng>=-77&&lng<=-74) return { city:"Virginia Beach", state:"VA", region:"VA", zip:"23464" };
  if (lat>=40&&lat<=41&&lng>=-75&&lng<=-73) return { city:"New York", state:"NY", region:"NY", zip:"10001" };
  if (lat>=33&&lat<=34.5&&lng>=-119&&lng<=-117) return { city:"Los Angeles", state:"CA", region:"CA", zip:"90001" };
  if (lat>=29&&lat<=30&&lng>=-96&&lng<=-94) return { city:"Houston", state:"TX", region:"TX", zip:"77001" };
  if (lat>=25&&lat<=26.5&&lng>=-81&&lng<=-79) return { city:"Miami", state:"FL", region:"FL", zip:"33101" };
  if (lat>=41&&lat<=42.5&&lng>=-88&&lng<=-87) return { city:"Chicago", state:"IL", region:"IL", zip:"60601" };
  if (lat>=33&&lat<=34.5&&lng>=-85&&lng<=-83) return { city:"Atlanta", state:"GA", region:"GA", zip:"30301" };
  if (lat>=47&&lat<=48&&lng>=-123&&lng<=-121) return { city:"Seattle", state:"WA", region:"WA", zip:"98101" };
  if (lat>=39&&lat<=40&&lng>=-105.5&&lng<=-104) return { city:"Denver", state:"CO", region:"CO", zip:"80201" };
  if (lat>=33&&lat<=34&&lng>=-113&&lng<=-111) return { city:"Phoenix", state:"AZ", region:"AZ", zip:"85001" };
  if (lat>=36&&lat<=37&&lng>=-87.5&&lng<=-86) return { city:"Nashville", state:"TN", region:"TN", zip:"37201" };
  if (lat>=29&&lat<=30.5&&lng>=-91&&lng<=-89) return { city:"New Orleans", state:"LA", region:"LA", zip:"70112" };
  return { city:"your area", state:"", region:"DEFAULT", zip:"00000" };
}

const VENUES = {
  VA:["Mount Trashmore Park","Sandler Center","Neptune Festival Grounds","Virginia Aquarium","Chesapeake City Park","Town Center VB","First Landing State Park","Oceanfront Boardwalk","Norfolk Botanical Garden","Pembroke Mall"],
  NY:["Central Park","Prospect Park","Bryant Park","Flushing Meadows","Governors Island","Brooklyn Bridge Park","Riverside Park","Fort Tryon Park","Astoria Park","The Battery"],
  CA:["Griffith Park","Echo Park","Grand Park","Venice Beach","Balboa Park","Exposition Park","Pan Pacific Park","Elysian Park","MacArthur Park","Palisades Park"],
  TX:["Hermann Park","Memorial Park","Discovery Green","Buffalo Bayou Park","NRG Park","Levy Park","Market Square Park","Eleanor Tinsley Park","Houston Arboretum","MacGregor Park"],
  FL:["Bayfront Park","Tropical Park","Crandon Park","Lummus Park","Virginia Key Beach","Peacock Park","Margaret Pace Park","South Pointe Park","Dreher Park","Mounts Botanical Garden"],
  IL:["Millennium Park","Grant Park","Lincoln Park","Maggie Daley Park","Humboldt Park","Jackson Park","Burnham Park","Douglas Park","Washington Park","Garfield Park"],
  GA:["Piedmont Park","Stone Mountain Park","Centennial Olympic Park","Grant Park","Chastain Park","Freedom Park","Candler Park","Inman Park","Kirkwood Park","Washington Park"],
  WA:["Gas Works Park","Volunteer Park","Discovery Park","Seward Park","Cal Anderson Park","Lincoln Park","Alki Beach","Greenlake Park","Ravenna Park","Arboretum"],
  CO:["City Park","Washington Park","Cheesman Park","Sloan's Lake","Ruby Hill Park","Harvard Gulch","Stapleton Central Park","Congress Park","Overland Park","Berkeley Park"],
  DEFAULT:["City Park","Riverside Park","Town Square","Community Center","Fairgrounds","Main Street Plaza","Heritage Park","Lakefront Park","Downtown Commons","Recreation Center"],
};

const TYPE_META = {
  Festival:  { color:"#f97316", label:"Festival" },
  Market:    { color:"#22c55e", label:"Market" },
  Music:     { color:"#ec4899", label:"Music" },
  Arts:      { color:"#a855f7", label:"Arts" },
  Family:    { color:"#3b82f6", label:"Family" },
  Food:      { color:"#eab308", label:"Food" },
  Community: { color:"#14b8a6", label:"Community" },
  Brewery:   { color:"#8b5cf6", label:"Brewery" },
  Carnival:  { color:"#f43f5e", label:"Carnival" },
  Kids:      { color:"#06b6d4", label:"Kids" },
  Other:     { color:"#94a3b8", label:"Other" },
};

const TYPE_ICONS = {
  Festival:"🎪", Market:"🌿", Music:"🎵", Arts:"🎨", Family:"👨‍👩‍👧",
  Food:"🍴", Community:"◎", Brewery:"◈", Carnival:"🎡", Kids:"✦", Other:"●",
};

function shuffle(arr){ return [...arr].sort(()=>Math.random()-0.5); }
function addDays(n){ const d=new Date(); d.setDate(d.getDate()+n); return d.toISOString().split("T")[0]; }
function formatDate(d){
  if(!d) return "TBD";
  try{ return new Date(d+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}); }
  catch{ return d; }
}
function isThisWeekend(dateStr){
  if(!dateStr) return false;
  const today=new Date(); today.setHours(0,0,0,0);
  const day=today.getDay();
  const fri=new Date(today); fri.setDate(today.getDate()+((5-day+7)%7));
  const sun=new Date(today); sun.setDate(today.getDate()+((7-day)%7||7));
  const ev=new Date(dateStr+"T00:00:00");
  return ev>=fri&&ev<=sun;
}
function getWeather(dateStr,region){
  const W={
    VA:[{i:"🌨",l:"38°",t:"Cold"},{i:"🌦",l:"52°",t:"Cool"},{i:"🌤",l:"62°",t:"Mild"},{i:"⛅",l:"70°",t:"Nice"},{i:"☀",l:"78°",t:"Warm"},{i:"🌡",l:"88°",t:"Hot"},{i:"🌡",l:"90°",t:"Hot"},{i:"🌡",l:"88°",t:"Hot"},{i:"☀",l:"80°",t:"Warm"},{i:"🌤",l:"68°",t:"Mild"},{i:"🌥",l:"56°",t:"Cool"},{i:"🌨",l:"44°",t:"Cold"}],
    FL:[{i:"🌤",l:"68°",t:"Nice"},{i:"☀",l:"72°",t:"Warm"},{i:"🌡",l:"80°",t:"Hot"},{i:"🌡",l:"85°",t:"Hot"},{i:"⛈",l:"88°",t:"Storms"},{i:"🌡",l:"92°",t:"Very hot"},{i:"🌡",l:"93°",t:"Very hot"},{i:"⛈",l:"92°",t:"Storms"},{i:"🌡",l:"89°",t:"Hot"},{i:"☀",l:"82°",t:"Warm"},{i:"🌤",l:"74°",t:"Nice"},{i:"🌤",l:"68°",t:"Nice"}],
    DEFAULT:[{i:"❄",l:"32°",t:"Cold"},{i:"🌥",l:"42°",t:"Cold"},{i:"🌤",l:"55°",t:"Mild"},{i:"⛅",l:"65°",t:"Nice"},{i:"☀",l:"72°",t:"Warm"},{i:"🌡",l:"82°",t:"Hot"},{i:"🌡",l:"85°",t:"Hot"},{i:"🌡",l:"83°",t:"Hot"},{i:"☀",l:"75°",t:"Warm"},{i:"🌤",l:"63°",t:"Cool"},{i:"🌥",l:"50°",t:"Cool"},{i:"❄",l:"38°",t:"Cold"}],
  };
  const month=new Date((dateStr||"2026-07-01")+"T00:00:00").getMonth();
  return (W[region]||W.DEFAULT)[month];
}

function generateEvents(zip, regionOverride){
  const info = regionOverride || getRegionInfo(zip);
  const venues=shuffle(VENUES[info.region]||VENUES.DEFAULT);
  const city=info.city;
  const T=[
    {name:`${city} Farmers Market`,type:"Market",cost:"Free",days:3,rating:5,minAge:0,maxAge:99,
     desc:`Fresh local produce, artisan crafts, and live music every weekend.`,
     sched:["8:00 AM · Market Opens","10:00 AM · Kids Cooking Demo","11:00 AM · Live Music","1:00 PM · Closes"]},
    {name:`Family Brewery Day`,type:"Brewery",cost:"Free",days:10,rating:4,minAge:0,maxAge:99,
     desc:`Local brewery opens for families — kids lemonade, yard games, and a live band.`,
     sched:["12:00 PM · Gates Open","1:00 PM · Live Band","3:00 PM · Homebrew Awards","6:00 PM · Closes"]},
    {name:`${city} Summer Festival`,type:"Festival",cost:"Free",days:17,rating:5,minAge:0,maxAge:99,
     desc:`The biggest free community festival of the summer. Food trucks, performances, and fireworks.`,
     sched:["10:00 AM · Festival Opens","12:00 PM · Kids Parade","3:00 PM · Main Stage","9:00 PM · Fireworks"]},
    {name:`Kids STEM Expo`,type:"Kids",cost:"$5",days:22,rating:5,minAge:5,maxAge:14,
     desc:`Robotics demos, hands-on science, and a coding workshop for ages 5–14.`,
     sched:["9:00 AM · Doors Open","10:00 AM · Robotics Challenge","12:00 PM · Coding Workshop","2:00 PM · Science Fair"]},
    {name:`Outdoor Movie Night`,type:"Community",cost:"Free",days:6,rating:4,minAge:0,maxAge:99,
     desc:`Free film under the stars with food trucks. Bring a blanket — starts at dusk.`,
     sched:["6:00 PM · Food Trucks Open","8:00 PM · Movie Starts"]},
    {name:`Art & Craft Fair`,type:"Arts",cost:"Free",days:30,rating:4,minAge:0,maxAge:99,
     desc:`80+ local artists, free kids activities, face painting, and live entertainment.`,
     sched:["9:00 AM · Opens","10:00 AM · Kids Workshop","1:00 PM · Face Painting","4:00 PM · Closes"]},
    {name:`Back to School Carnival`,type:"Carnival",cost:"Free",days:45,rating:5,minAge:3,maxAge:14,
     desc:`Bounce houses, prizes, and a free school supplies giveaway for kids ages 3–14.`,
     sched:["11:00 AM · Opens","12:00 PM · Supplies Giveaway","2:00 PM · Pie Eating Contest","4:00 PM · Raffle"]},
    {name:`Jazz in the Park`,type:"Music",cost:"Free",days:14,rating:3,minAge:0,maxAge:99,
     desc:`Free outdoor jazz and blues every weekend this summer. Blankets welcome.`,
     sched:["5:00 PM · Opening Act","7:00 PM · Headliner","9:00 PM · Encore"]},
    {name:`Food Truck Festival`,type:"Food",cost:"Free",days:35,rating:4,minAge:0,maxAge:99,
     desc:`30+ food trucks, live music, and a family eating contest. Vote for your favorite.`,
     sched:["11:00 AM · Opens","12:00 PM · Voting Opens","2:00 PM · Kids Contest","5:00 PM · Winner"]},
    {name:`Toddler Splash Day`,type:"Kids",cost:"$3",days:12,rating:5,minAge:0,maxAge:5,
     desc:`Splash pads, bubbles, floaties, and story time for babies and toddlers ages 0–5.`,
     sched:["9:00 AM · Splash Pad Opens","10:00 AM · Bubble Party","11:00 AM · Story Time","12:00 PM · Closes"]},
    {name:`Cultural Heritage Festival`,type:"Festival",cost:"$5",days:28,rating:4,minAge:0,maxAge:99,
     desc:`Food, music, dance, and art celebrating the diversity of the community.`,
     sched:["10:00 AM · Opens","12:00 PM · Dance Performances","2:00 PM · Food Competition","4:00 PM · Ceremony"]},
    {name:`Neighborhood Block Party`,type:"Community",cost:"Free",days:20,rating:5,minAge:0,maxAge:99,
     desc:`Grilling, games, live music, and kids activities — hosted by the local community.`,
     sched:["3:00 PM · Starts","4:00 PM · Kids Games","6:00 PM · Live Band","8:00 PM · Closes"]},
  ];
  return T.map((t,i)=>{
    const date=addDays(t.days);
    return {
      id:String(i+1), name:t.name, type:t.type,
      emoji:TYPE_ICONS[t.type]||"●",
      photo:getPhoto(t.type, String(i+1)),
      date, location:venues[i%venues.length],
      address:`${venues[i%venues.length]}, ${city}${info.state?", "+info.state:""}`,
      cost:t.cost, desc:t.desc, rating:t.rating,
      minAge:t.minAge, maxAge:t.maxAge,
      weather:getWeather(date,info.region),
      isWeekend:isThisWeekend(date), sched:t.sched,
    };
  });
}

// ── Number Pad ────────────────────────────────────────────────────────────────
function NumPad({value, onChange, onSearch}){
  const keys=["1","2","3","4","5","6","7","8","9","⌫","0","→"];
  const ready=value.length===5;
  const tap=(k)=>{
    if(k==="⌫"){onChange(value.slice(0,-1));return;}
    if(k==="→"){if(ready)onSearch();return;}
    if(value.length<5)onChange(value+k);
  };
  return(
    <div style={{width:"100%",maxWidth:300,margin:"0 auto"}}>
      <div style={{marginBottom:20,textAlign:"center"}}>
        <div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:8}}>
          {[0,1,2,3,4].map(i=>(
            <div key={i} style={{width:44,height:52,borderRadius:10,background:value[i]?"rgba(255,255,255,0.12)":"rgba(255,255,255,0.05)",border:`1.5px solid ${value[i]?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.08)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:700,color:"#fff",transition:"all 0.15s"}}>
              {value[i]||""}
            </div>
          ))}
        </div>
        <div style={{fontSize:12,color:ready?"#86efac":"rgba(255,255,255,0.3)",fontWeight:500,letterSpacing:1,textTransform:"uppercase",transition:"color 0.2s"}}>
          {ready?"Ready — tap Search":"Enter 5-digit ZIP code"}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
        {keys.map(k=>{
          const isSearch=k==="→"; const isBack=k==="⌫";
          const disabled=isSearch&&!ready;
          return(
            <div key={k} onClick={()=>!disabled&&tap(k)} style={{height:56,borderRadius:14,background:isSearch?(ready?"rgba(255,255,255,0.95)":"rgba(255,255,255,0.05)"):isBack?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.08)",color:isSearch?(ready?"#0f172a":"rgba(255,255,255,0.15)"):isBack?"rgba(255,255,255,0.5)":"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:isSearch?13:20,fontWeight:isSearch?700:500,cursor:disabled?"not-allowed":"pointer",border:"1px solid rgba(255,255,255,0.06)",letterSpacing:isSearch?0.5:0,transition:"all 0.1s",userSelect:"none"}}>
              {isSearch?"Search":k}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App(){
  const [screen,setScreen]=useState("home");
  const [zip,setZip]=useState("");
  const [events,setEvents]=useState([]);
  const [info,setInfo]=useState(null);
  const [openId,setOpenId]=useState(null);
  const [typeFilter,setTypeFilter]=useState("All");
  const [freeOnly,setFreeOnly]=useState(false);
  const [weekendOnly,setWeekendOnly]=useState(false);
  const [favs,setFavs]=useState(new Set());
  const [toast,setToast]=useState("");
  const [gpsLoading,setGpsLoading]=useState(false);
  const [photoError,setPhotoError]=useState({});

  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(""),2200);};

  // ── GPS ──────────────────────────────────────────────────────────────────
  const detectLocation=()=>{
    if(!navigator.geolocation){showToast("GPS not available");return;}
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos=>{
        const {latitude:lat,longitude:lng}=pos.coords;
        const regionData=latLngToRegion(lat,lng);
        const evs=generateEvents(regionData.zip,{...regionData,lat,lng});
        setInfo(regionData);
        setZip(regionData.zip);
        setEvents(evs);
        setOpenId(null);setTypeFilter("All");setFreeOnly(false);setWeekendOnly(false);
        setGpsLoading(false);
        setScreen("results");
        showToast(`📍 Found you in ${regionData.city}`);
      },
      err=>{
        setGpsLoading(false);
        showToast("Couldn't get location — enter ZIP manually");
      },
      {timeout:8000,enableHighAccuracy:false}
    );
  };

  const doSearch=()=>{
    if(zip.length!==5)return;
    const regionInfo=getRegionInfo(zip);
    setInfo(regionInfo);
    setEvents(generateEvents(zip));
    setOpenId(null);setTypeFilter("All");setFreeOnly(false);setWeekendOnly(false);
    setScreen("results");
  };

  const reset=()=>{setScreen("home");setZip("");setEvents([]);setInfo(null);};
  const toggleFav=id=>setFavs(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const m=t=>TYPE_META[t]||{color:"#94a3b8",label:"Other"};

  const types=["All",...Array.from(new Set(events.map(e=>e.type)))];
  const filtered=events.filter(ev=>{
    if(typeFilter!=="All"&&ev.type!==typeFilter)return false;
    if(freeOnly&&ev.cost!=="Free")return false;
    if(weekendOnly&&!ev.isWeekend)return false;
    return true;
  });

  // ── HOME SCREEN ───────────────────────────────────────────────────────────
  if(screen==="home") return(
    <div style={{minHeight:"100vh",background:"#0a0a0f",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 24px",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:"-20%",left:"50%",transform:"translateX(-50%)",width:500,height:500,background:"radial-gradient(circle,rgba(99,102,241,0.15) 0%,transparent 70%)",pointerEvents:"none"}}/>
      <div style={{position:"absolute",bottom:"-10%",right:"-10%",width:300,height:300,background:"radial-gradient(circle,rgba(16,185,129,0.08) 0%,transparent 70%)",pointerEvents:"none"}}/>

      {toast&&<div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",zIndex:2000,background:"rgba(255,255,255,0.1)",backdropFilter:"blur(12px)",color:"#fff",padding:"10px 20px",borderRadius:999,fontSize:13,fontWeight:600,border:"1px solid rgba(255,255,255,0.15)",whiteSpace:"nowrap"}}>{toast}</div>}

      <div style={{position:"relative",width:"100%",maxWidth:360,textAlign:"center"}}>
        <div style={{marginBottom:28}}>
          <div style={{width:64,height:64,borderRadius:20,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",margin:"0 auto 16px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,boxShadow:"0 8px 32px rgba(99,102,241,0.4)"}}>◈</div>
          <h1 style={{margin:0,fontSize:28,fontWeight:700,color:"#fff",letterSpacing:"-0.5px",lineHeight:1.1}}>Family Events</h1>
          <p style={{color:"rgba(255,255,255,0.3)",fontSize:13,marginTop:6,letterSpacing:0.3}}>Find things to do near you</p>
        </div>

        {/* GPS Button */}
        <div onClick={detectLocation} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"13px 20px",borderRadius:14,background:"rgba(99,102,241,0.12)",border:"1px solid rgba(99,102,241,0.25)",cursor:"pointer",marginBottom:20,transition:"all 0.15s"}}>
          {gpsLoading
            ? <><div style={{width:16,height:16,borderRadius:"50%",border:"2px solid rgba(165,180,252,0.3)",borderTopColor:"#a5b4fc",animation:"spin 0.8s linear infinite"}}/>
               <span style={{color:"#a5b4fc",fontSize:13,fontWeight:600}}>Detecting location…</span></>
            : <><span style={{fontSize:16}}>📍</span>
               <span style={{color:"#a5b4fc",fontSize:13,fontWeight:600}}>Use my current location</span></>
          }
        </div>

        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
          <div style={{flex:1,height:1,background:"rgba(255,255,255,0.06)"}}/>
          <span style={{color:"rgba(255,255,255,0.2)",fontSize:11,letterSpacing:1,textTransform:"uppercase"}}>or enter ZIP</span>
          <div style={{flex:1,height:1,background:"rgba(255,255,255,0.06)"}}/>
        </div>

        <NumPad value={zip} onChange={setZip} onSearch={doSearch}/>

        <div style={{marginTop:24,display:"flex",gap:6,flexWrap:"wrap",justifyContent:"center"}}>
          {["Markets","Festivals","Brewery","Kids","Community","Music"].map(t=>(
            <span key={t} style={{padding:"4px 11px",borderRadius:999,background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.25)",fontSize:11,border:"1px solid rgba(255,255,255,0.05)"}}>{t}</span>
          ))}
        </div>
      </div>
      <style>{`*{box-sizing:border-box;margin:0;padding:0;}@keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}`}</style>
    </div>
  );

  // ── RESULTS SCREEN ────────────────────────────────────────────────────────
  return(
    <div style={{minHeight:"100vh",background:"#0a0a0f",color:"#fff"}}>
      {toast&&<div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",zIndex:2000,background:"rgba(255,255,255,0.1)",backdropFilter:"blur(12px)",color:"#fff",padding:"10px 20px",borderRadius:999,fontSize:13,fontWeight:600,border:"1px solid rgba(255,255,255,0.15)",whiteSpace:"nowrap"}}>{toast}</div>}

      {/* Header */}
      <div style={{padding:"20px 16px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)",position:"sticky",top:0,background:"rgba(10,10,15,0.95)",backdropFilter:"blur(12px)",zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:12,maxWidth:700,margin:"0 auto"}}>
          <div onClick={reset} style={{width:36,height:36,borderRadius:10,background:"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:16,border:"1px solid rgba(255,255,255,0.08)",flexShrink:0}}>←</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:700,fontSize:16,letterSpacing:"-0.3px"}}>
              {info?.city}{info?.state?`, ${info.state}`:""} <span style={{color:"rgba(255,255,255,0.25)",fontWeight:400,fontSize:13}}>· {zip}</span>
            </div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.3)",marginTop:1}}>{events.length} upcoming events</div>
          </div>
          <div onClick={reset} style={{padding:"7px 14px",borderRadius:10,background:"rgba(99,102,241,0.12)",color:"#a5b4fc",fontSize:12,fontWeight:600,cursor:"pointer",border:"1px solid rgba(99,102,241,0.2)",flexShrink:0,whiteSpace:"nowrap"}}>New Search</div>
        </div>
        {/* Stats */}
        <div style={{display:"flex",gap:6,marginTop:10,maxWidth:700,margin:"10px auto 0",flexWrap:"wrap"}}>
          {[
            {l:`${events.length} Events`,bg:"rgba(255,255,255,0.05)",c:"rgba(255,255,255,0.4)"},
            {l:`${events.filter(e=>e.cost==="Free").length} Free`,bg:"rgba(16,185,129,0.08)",c:"#6ee7b7"},
            ...(events.filter(e=>e.isWeekend).length?[{l:`${events.filter(e=>e.isWeekend).length} This Weekend`,bg:"rgba(99,102,241,0.08)",c:"#a5b4fc"}]:[]),
            ...(favs.size?[{l:`${favs.size} Saved`,bg:"rgba(245,158,11,0.08)",c:"#fcd34d"}]:[]),
          ].map(s=><span key={s.l} style={{padding:"3px 10px",borderRadius:8,background:s.bg,color:s.c,fontSize:11,fontWeight:600}}>{s.l}</span>)}
        </div>
      </div>

      <div style={{maxWidth:700,margin:"0 auto",padding:"14px 14px 80px"}}>
        {/* Filters */}
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:7}}>
            {types.map(t=>{
              const active=typeFilter===t; const meta=m(t);
              return <div key={t} onClick={()=>setTypeFilter(t)} style={{padding:"5px 12px",borderRadius:999,background:active?meta.color:"rgba(255,255,255,0.05)",color:active?"#fff":"rgba(255,255,255,0.4)",fontSize:12,fontWeight:active?700:400,cursor:"pointer",border:`1px solid ${active?meta.color:"rgba(255,255,255,0.05)"}`,transition:"all 0.15s"}}>{t}</div>;
            })}
          </div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {[
              {l:"Free Only",a:freeOnly,fn:()=>setFreeOnly(!freeOnly),ac:"#6ee7b7",bc:"rgba(16,185,129,0.12)"},
              {l:"This Weekend",a:weekendOnly,fn:()=>setWeekendOnly(!weekendOnly),ac:"#a5b4fc",bc:"rgba(99,102,241,0.12)"},
              {l:"Clear",a:false,fn:()=>{setTypeFilter("All");setFreeOnly(false);setWeekendOnly(false);},ac:"rgba(255,255,255,0.3)",bc:"rgba(255,255,255,0.04)"},
            ].map(f=><div key={f.l} onClick={f.fn} style={{padding:"5px 12px",borderRadius:999,background:f.a?f.bc:"rgba(255,255,255,0.04)",color:f.a?f.ac:"rgba(255,255,255,0.25)",fontSize:12,fontWeight:f.a?600:400,cursor:"pointer",border:`1px solid ${f.a?f.ac:"rgba(255,255,255,0.05)"}`,transition:"all 0.15s"}}>{f.l}</div>)}
          </div>
        </div>

        <p style={{fontSize:11,color:"rgba(255,255,255,0.18)",marginBottom:14,letterSpacing:0.5,textTransform:"uppercase"}}>{filtered.length} of {events.length} events</p>

        {filtered.length===0&&(
          <div style={{textAlign:"center",padding:"48px 0"}}>
            <div style={{fontSize:32,marginBottom:12,opacity:0.2}}>◯</div>
            <p style={{color:"rgba(255,255,255,0.25)",fontSize:14}}>No events match your filters</p>
            <div onClick={()=>{setTypeFilter("All");setFreeOnly(false);setWeekendOnly(false);}} style={{display:"inline-block",marginTop:12,padding:"8px 18px",borderRadius:10,background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.4)",fontSize:13,cursor:"pointer",border:"1px solid rgba(255,255,255,0.07)"}}>Clear filters</div>
          </div>
        )}

        <div style={{display:"flex",flexDirection:"column",gap:3}}>
          {filtered.map((ev,idx)=>{
            const meta=m(ev.type);
            const isOpen=openId===ev.id;
            const isFav=favs.has(ev.id);
            const imgErr=photoError[ev.id];
            return(
              <div key={ev.id} style={{borderRadius:16,overflow:"hidden",background:isOpen?"rgba(255,255,255,0.04)":"transparent",border:`1px solid ${isOpen?"rgba(255,255,255,0.07)":"transparent"}`,marginBottom:isOpen?6:0,transition:"all 0.2s"}}>

                {/* ── Event photo (shown when open) ── */}
                {isOpen&&!imgErr&&(
                  <div style={{position:"relative",height:160,overflow:"hidden",background:"rgba(255,255,255,0.04)"}}>
                    <img
                      src={ev.photo}
                      alt={ev.name}
                      onError={()=>setPhotoError(p=>({...p,[ev.id]:true}))}
                      style={{width:"100%",height:"100%",objectFit:"cover",opacity:0.7}}
                    />
                    {/* Gradient overlay */}
                    <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(10,10,15,0.8) 0%,transparent 50%)"}}/>
                    {/* Type pill over photo */}
                    <div style={{position:"absolute",top:10,left:12,padding:"4px 10px",borderRadius:999,background:"rgba(0,0,0,0.5)",backdropFilter:"blur(8px)",border:`1px solid ${meta.color}40`,color:meta.color,fontSize:11,fontWeight:700,letterSpacing:0.5}}>
                      {ev.type}
                    </div>
                    {/* Weekend badge */}
                    {ev.isWeekend&&<div style={{position:"absolute",top:10,right:12,padding:"4px 10px",borderRadius:999,background:"rgba(99,102,241,0.6)",backdropFilter:"blur(8px)",color:"#fff",fontSize:11,fontWeight:700}}>This Weekend</div>}
                  </div>
                )}

                {/* ── Card row ── */}
                <div onClick={()=>setOpenId(isOpen?null:ev.id)} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 4px",cursor:"pointer",borderBottom:idx<filtered.length-1&&!isOpen?"1px solid rgba(255,255,255,0.04)":"none"}}>
                  <div style={{width:44,height:44,borderRadius:12,background:`${meta.color}15`,border:`1px solid ${meta.color}25`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0,color:meta.color}}>
                    {ev.emoji}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3,flexWrap:"wrap"}}>
                      {!isOpen&&<span style={{fontSize:10,fontWeight:700,color:meta.color,textTransform:"uppercase",letterSpacing:0.8}}>{ev.type}</span>}
                      {ev.isWeekend&&!isOpen&&<span style={{fontSize:10,fontWeight:600,color:"#a5b4fc",background:"rgba(99,102,241,0.1)",padding:"1px 6px",borderRadius:4}}>Weekend</span>}
                      {ev.cost==="Free"&&<span style={{fontSize:10,fontWeight:600,color:"#6ee7b7",background:"rgba(16,185,129,0.08)",padding:"1px 6px",borderRadius:4}}>Free</span>}
                    </div>
                    <div style={{fontWeight:600,fontSize:14,color:"#f1f5f9",lineHeight:1.3,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.name}</div>
                    <div style={{display:"flex",gap:8}}>
                      <span style={{fontSize:11,color:"rgba(255,255,255,0.3)"}}>{formatDate(ev.date)}</span>
                      <span style={{fontSize:11,color:"rgba(255,255,255,0.18)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>· {ev.location}</span>
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,flexShrink:0}}>
                    <div onClick={e=>{e.stopPropagation();toggleFav(ev.id);}} style={{fontSize:16,cursor:"pointer",opacity:isFav?1:0.25,color:isFav?"#fbbf24":"#fff",transition:"all 0.15s"}}>{isFav?"★":"☆"}</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.18)",transform:isOpen?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.2s"}}>▾</div>
                  </div>
                </div>

                {/* ── Expanded detail ── */}
                {isOpen&&(
                  <div style={{padding:"4px 14px 16px"}}>
                    {/* Info bar */}
                    <div style={{display:"flex",gap:8,marginBottom:14}}>
                      {ev.weather&&(
                        <div style={{flex:1,background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"8px 12px",border:"1px solid rgba(255,255,255,0.06)"}}>
                          <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",marginBottom:2,textTransform:"uppercase",letterSpacing:0.5}}>Weather</div>
                          <div style={{fontSize:13,fontWeight:600,color:"#f1f5f9"}}>{ev.weather.i} {ev.weather.l} · {ev.weather.t}</div>
                        </div>
                      )}
                      <div style={{flex:1,background:`${meta.color}10`,borderRadius:10,padding:"8px 12px",border:`1px solid ${meta.color}18`}}>
                        <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",marginBottom:2,textTransform:"uppercase",letterSpacing:0.5}}>Cost</div>
                        <div style={{fontSize:13,fontWeight:700,color:meta.color}}>{ev.cost}</div>
                      </div>
                    </div>

                    <p style={{fontSize:13,color:"rgba(255,255,255,0.45)",lineHeight:1.65,marginBottom:14}}>{ev.desc}</p>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.18)",marginBottom:8,textTransform:"uppercase",letterSpacing:0.8}}>Schedule</div>
                    <div style={{display:"flex",flexDirection:"column",gap:0,marginBottom:14}}>
                      {ev.sched.map((s,i)=>{
                        const parts=s.split(" · ");
                        return(
                          <div key={i} style={{display:"flex",gap:12,padding:"8px 0",borderBottom:i<ev.sched.length-1?"1px solid rgba(255,255,255,0.04)":"none"}}>
                            <span style={{fontSize:12,color:meta.color,minWidth:72,fontWeight:600}}>{parts[0]}</span>
                            <span style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>{parts[1]||""}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <div onClick={()=>{const d=ev.date?.replace(/-/g,"");window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.name)}&dates=${d}/${d}&location=${encodeURIComponent(ev.address)}`,"_blank");}} style={{flex:1,padding:"11px",borderRadius:11,background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.5)",fontSize:12,fontWeight:600,textAlign:"center",cursor:"pointer",border:"1px solid rgba(255,255,255,0.07)"}}>
                        📅 Calendar
                      </div>
                      <div onClick={()=>{const txt=`${ev.name} — ${formatDate(ev.date)} at ${ev.location}. ${ev.cost==="Free"?"Free!":""}`;if(navigator.share)navigator.share({title:ev.name,text:txt});else{navigator.clipboard?.writeText(txt);showToast("Copied to clipboard!");};}} style={{flex:1,padding:"11px",borderRadius:11,background:`${meta.color}12`,color:meta.color,fontSize:12,fontWeight:600,textAlign:"center",cursor:"pointer",border:`1px solid ${meta.color}20`}}>
                        Share ↗
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <style>{`*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}@keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}
