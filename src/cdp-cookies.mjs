// Read pump.fun cookies from the MAIN Chrome profile via CDP attach
// (their real session where the $8 was earned)
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
console.log("pages:", list.filter(t=>t.type==="page").map(t=>t.url).slice(0,8));
