#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { exit } = require("node:process");
const dir = path.join(__dirname, "format-data");

const sqlite3 = require('sqlite3').verbose();


function cleanName(name){
  if(!name) return
  return name.trim().split(",")[0].replace(" ","-").toLowerCase().replace("-resolute","").replace("-*","").replace("%","").replace("-totem","").replace(".","")
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//Functions relating to filling a line of the sheet from nothing but the replay url

async function SingleReplayImport(url,db,toururl="",fetchid=-1,replace=false) {
  let format = url.replace("https://","").replace("replay.pokemonshowdown.com/","").replace("smogtours-","").replace("gold-","").replace("netbattle-","").replace("shoddy-","").replace("pokemononline-","").replace("pokemonshowdown-","").split("-")[0]
  if (format=="ou") format="gen6ou"
  
  url="https://replay.pokemonshowdown.com/"+url.replace("https://","").replace("replay.pokemonshowdown.com/","")
  url = url.replace("?p2","").replace("#/","")
  let resp;
  try {
  resp = await fetch(url+".json");} catch(err){console.error("The URL that failed is "+url+", in the thread "+toururl+".","The error was "+err);return format}
  if (resp.status===404) return format
  const data = await resp.json()
  var log = data["log"].split("\n")

  if (!log.includes("|clearpoke")){
      var team1=[]
      var team2=[]
      var teams=["lmao",team1,team2]
      log.forEach(line=>{
      for (var i=1;i<3;i++){
          if (line.includes("|switch|p"+i+"a:")){
          var mon = cleanName(line.split("|")[3])
          if (!teams[i].includes(mon)){teams[i].push(mon)}
      }}
      })
      while (team1.length<6){team1.push("")}
      while (team2.length<6){team2.push("")}
  }
  else {
    var team1 = log.filter(x=>x.includes("|poke|p1|")).map(x=>cleanName(x.split("|")[3]))
    var team2 = log.filter(x=>x.includes("|poke|p2|")).map(x=>cleanName(x.split("|")[3]))
    while (team1.length<6){team1.push("")}
    while (team2.length<6){team2.push("")}
  }

  let [info1,info2,turnCount]=getInfos(log)
  
  info1.player=data.players[0]
  info2.player=data.players[1]
  info1["style"]=StyleGuesser(team1,info1["moves"],format)
  info2["style"]=StyleGuesser(team2,info2["moves"],format)
  

  
  if (log.includes("|win|"+info2.player)){[team1,team2,info1,info2]=[team2,team1,info2,info1];url+="?p2"}
  
  var toInsert = [fetchid,url,format,team1.join("."),team2.join("."),JSON.stringify(info1),JSON.stringify(info2),data["uploadtime"],IsASample([team1,team2],format),turnCount]
  
  // console.log(`INSERT INTO `+format+" (fetchid,url,team1,team2,player1,player2,style1,style2,date,isASample) VALUE("+toInsert+");")

  await db.serialize(() => {db.run("INSERT INTO replayData (fetchid,url,format,team1,team2,info1,info2,date,isASample,turnCount) VALUES (?,?,?,?,?,?,?,?,?,?);",toInsert,(err)=>{
  if (err?.code === "SQLITE_CONSTRAINT" && replace) {console.log("refreshing replay "+url);db.run("UPDATE replaydata SET fetchid=?, team1=?, team2=?, info1=?, info2=?, isASample=? WHERE url==?",[fetchid,team1.join("."),team2.join("."),JSON.stringify(info1),JSON.stringify(info2),IsASample([team1,team2],format),url])}})});
  debugger
  return format
}

function getInfos(log){
  let out=[{},{}]
  for (var i=1;i<3;i++){
    let nicks = {}
    let detailChange={}
    log.filter(x=>x.includes("|switch|p"+i+"a: ")||x.includes("|drag|p"+i+"a: ")||x.includes("|switch|p"+i+"b: ")||x.includes("|drag|p"+i+"b: ")||x.includes("|replace|p"+i+"a:")||x.includes("|replace|p"+i+"b:"))
      .forEach(x=>{if(!out[i-1]["lead"]) out[i-1]["lead"]=cleanName(x.split("|")[3]); if (!nicks[x.split("|")[2].slice(5)]) nicks[x.split("|")[2].slice(5)]=cleanName(x.split("|")[3])})
    Object.entries(nicks).forEach(X=>{let x=X[1];let a=monsToUpdate.findIndex(y=>x.includes(y));if (a!=-1) {detailChange[monsToUpdate[a]]=x;nicks[X[0]]=monsToUpdate[a]}})
    
    let moves={}
    log.filter(x=>x.includes("|move|p"+i)&!x.includes("[zeffect]")&!x.includes("[from] ability")).forEach(x=>{
      let mon=nicks[x.slice(11).split("|")[0]]
      let move=x.split("|")[3].replace("Z-","")
      if (!moves[mon]) {moves[mon]=[[move,1]];return}
      let a=moves[mon].map(x=>x[0]).indexOf(move)
      if (a!=-1) moves[mon][a][1]+=1
      else  moves[mon].push([move,1])
    })
    if (moves["ditto"]) moves["ditto"]=[]
    out[i-1]["moves"]=moves
    
    let items={}
    log.filter(x=>x.includes("p"+i+"a: ")||x.includes("p"+i+"b: ")).forEach(x=>{
      if (x.includes("[from] item:")){
        if (x.includes("|[of] p"+i)) {items[nicks[x.split("|[of] p"+i)[1].slice(3).replace("|","")]]=cleanName(x.split("|")[4].slice(13))}
        else if (!x.includes("|[of] p"+(i%2+1))) items[nicks[x.split("|")[2].slice(5)]]=cleanName(x.split("|")[4].slice(13))
      }
      else if (x.includes("|-enditem|p"+i)) items[nicks[x.split("|")[2].slice(5)]]=cleanName(x.split("|")[3])
    })
    
    log.forEach((x,index)=>{if ((x.includes("|detailschange|p"+i+"a: ")||x.includes("|detailschange|p"+i+"b: "))&!x.includes("Mimikyu-Busted")){
      detailChange[nicks[x.slice(20).split("|")[0]]]=cleanName(x.split("|")[3])
      if ((log[index+1].includes("|-mega")||log[index+1].includes("|-primal"))&log[index+1].split("|").length>=4) items[nicks[x.slice(20).split("|")[0]]] = "formItem:"+cleanName(log[index+1].split("|")[3])
      if (log[index+1].includes("|-burst")&log[index+1].split("|").length==5) items[nicks[x.slice(20).split("|")[0]]] = "Zmove:"+cleanName(log[index+1].split("|")[4])
    }})
  
    if (log.some(line=>line.includes("|-zpower|"))){
      let index=log.findIndex(x=>x.startsWith("|-zpower|p"+i+"a:"))
      if (index!=-1) {
        nick=log[index].slice(14)
        items[nicks[nick]]="Zmove:"+(moveToZ[log[index+1].split("|")[3]]||moveToZ[log[index+2].split("|")[3]])
      }
    }
    if (Object.values(nicks).includes("giratina-origin")) items["giratina-origin"]="griseous-orb"
    out[i-1]["items"]=items
    out[i-1]["changes"]=detailChange

    let line=log.filter(x=>x.startsWith("|-terastallize|p"+i))[0]
    if (line) out[i-1]["tera"]=[nicks[line.split("|")[2].slice(5)],line.split("|")[3]]
    debugger
  }
  out.push(+log.filter(x=>x.includes("|turn|")).at(-1).split("|")[2])
  return out
}


function StyleGuesser(team,moves,format){
  if (format=="gen7ou"&((team.includes("tyranitar")&&team.includes("excadrill")) || team.includes("pelipper")|| team.includes("torkoal"))){return("Weather")}

  let values;
  try{
  values = fs.readFileSync('./format-data/'+format+'/styleScores.csv',{ encoding: 'utf8', flag: 'r' }).replace('"','').split("\r\n").splice(1).map(line=>line.split(","))}catch(err){warnOnce('There are no style ratings for '+format); return ""}

  //create an array of dictionnaries, where the keys are the pokemon's name
  var StyleScores=[{},{},{}]
  values.forEach(line=>{
    for (var j=0;j<3;j++){StyleScores[j][line[0]]=line[j+1]}
  })
  //calculate the score of the team
  var score = [0,0,0]
  for (var i = 0; i<6;i++){
    var mon=team[i].replace("-east","")
    if (Object.keys(StyleScores[0]).includes(mon+". ")){
      let movesToSearch = []
      Object.keys(StyleScores[0]).forEach(mons=>{if (mons.includes(mon)){movesToSearch.push(mons.split(".").splice(1).map(x=>cleanName(x)))}})
      let overlap=[]
      if(moves[mon]) overlap = movesToSearch.filter(moveList=>moveList.every(move=>cleanName(moves[mon].map(x=>x[0])[0]).includes(move)))
      mon+=". " + (overlap.length>0?overlap.at(-1).join(". "):"")
    }
    for (j=0;j<3;j++){
      score[j]+=(2**StyleScores[j][mon]||0)
    }
  }
  var names = ["Offence","Hyper Offence", "Defence"]
  
  //check if two styles are close in score
  let a = 1/closeness(score)
  if (a>=4){var modscore=[...score];modscore[maxes(score)[1]]=0;//debugger;
  return (names[maxes(score)[1]]+"/"+names[maxes(modscore)[1]])}
  
  return (names[maxes(score)[1]])
}

//takes 2 teams and checks if either of them has at least 5 mons in common with the teams on the sample sheet.
function IsASample(teams,format){
  let samples;
  try {
  samples = fs.readFileSync("./format-data/"+format+"/samples.csv",{ encoding: 'utf8', flag: 'r' }).split("\r\n").map(line=>line.split(","))} catch(err){warnOnce('There are no sample teams for '+format); return ""}
  // debugger
  for (var i=0;i<2;i++){
    if (samples.slice(0,samples.findIndex(item=>item.length==1&item[0]=="OLD")).some(s => s.filter(x=>teams[i].includes(x)).length>=5)){return "Yes"}
  }
  for (var i=0;i<2;i++){
    if (samples.some(s => s.filter(x=>teams[i].includes(x)).length>=5)){return "Yes (old)"}
  }  
  return "No"
}

function maxes(array){
  //returns a Int[2], 1st element is the max of the array and the 2nd is the 
  if (array.length==0){return -1}
  var argmax=0
  var max=array[0]
  for (var i=0;i<array.length;i++){
    if (array[i]>max) {[argmax,max]=[i,array[i]]}
  }
  return [max,argmax]
}

function closeness(array){
  var max=maxes(array)[0]
  var diff = Array(array.length)
  for (i=0;i<array.length;i++){diff[i]=(max-array[i])/max}
  var [min,argmin]=maxes(diff)
  for (i=0;i<array.length;i++){if (diff[i]<min && diff[i]>0){[min,argmin]=[diff[i],i]}}
  return min
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//Functions relating to extracting all the replay links posted in a smogon thread

async function SmogThreadImport(url1,tourName,tourRound) {
  const db=new sqlite3.Database('./data.db', sqlite3.OPEN_READWRITE)
  let id=-1
  let LinkList
  if (RegExp('(?:#)?post-[0-9]*\/$').test(url1)){
    url1=url1.slice(0, -1)
    let post=url1.split("/").at(-1).split("#").at(-1)
    url1=url1.replace("smogon.com","").replace("www.","").replace("https://","").replace("http://","")
    var url="https://www.smogon.com"+url1
    id= await addToThreadDB(url,tourName,tourRound,db)
    try {resp = await fetch(url);} catch(err){console.error("The thread URL that failed is "+url+".","The error was "+err);return}
    var html = await resp.text()
    if (html.includes('<title>Oops! We ran into some problems. | Smogon Forums</title>')) {console.error("The thread "+url+" was not found.");return}
    LinkList = ReplayFinderFromHTML(html.split('data-content="'+post+'"')[1].split("</article>")[0])
  }
  else{
    url1=url1.replace("smogon.com","").replace("www.","").replace("https://","").replace("http://","").replace(/page-\d+\/?$/, "")

    var page=1
    var DomainLink = url1+"page-"
    var baseurl=DomainLink+String(page)
    var url="https://www.smogon.com"+baseurl
    id= await addToThreadDB(url,tourName,tourRound,db)
    let resp;
    try {resp = await fetch(url);} catch(err){console.error("The thread URL that failed is "+url+".","The error was "+err);return}
    var html = await resp.text()
    if (html.includes('<title>Oops! We ran into some problems. | Smogon Forums</title>')) {console.error("The thread "+url+" was not found.");return}
    LinkList = ReplayFinderFromHTML(html)
    while(html.includes(DomainLink+String(page+1))){
      page+=1
      console.log("Page "+String(page)+" exists!")
      baseurl=DomainLink+String(page)
      url="https://www.smogon.com"+baseurl
      try {resp = await fetch(url);} catch(err){console.error("The thread URL that failed is "+url+".","The error was "+err);return}
      var html = (await resp.text()).replace(/<aside class="message-signature">[\s\S]*?<\/aside>/g,'')
      // debugger
      LinkList = new Set([...LinkList, ...ReplayFinderFromHTML(html)])
  }}
  debugger
  var formats=[]
  console.log("About to import "+LinkList.size+" replays")
  for (const x of LinkList){try { formats.push(await SingleReplayImport(x,db,"https://www.smogon.com"+url1,id))}catch(err){console.error("Failed for "+x+" from https://www.smogon.com"+url1,err)}}
  db.close()
  formats = [...new Set(formats)]
  debugger
  for (var i=0;i<formats.length;i++) await exportData(formats[i])
  
  return LinkList.length
}
function addToThreadDB(url,tourName,tourRound,db){
  return new Promise((resolve,reject)=>{ db.serialize(()=>
    db.run('INSERT OR IGNORE INTO fetchedThreads (url,threadName,threadRound) VALUES ("'+url+'","'+tourName+'","'+tourRound+'")',
      function (err) {
        if (err) return reject(err);
        if (this.changes >0) resolve(this.lastID);
        db.get(
                'SELECT id FROM fetchedThreads WHERE url ="'+url+'"', 
                (err, row) => {
                  if (err) reject(err);
                  else resolve(row.id);})})
  ) })
}
function ReplayFinderFromHTML(html){
  var LinkList=new Set([])
  html=html.replaceAll('href="http://replay.pokemonshowdown.com/','href="https://replay.pokemonshowdown.com/')
  while (html.includes('href="https://replay.pokemonshowdown.com/')){
    html=html.slice(html.indexOf('href="https://replay.pokemonshowdown.com/')+6)
    var replayLink = html.slice(0,html.indexOf('"'))
    LinkList.add(replayLink)
  }
  return(LinkList)
}

async function exportData(format){
  console.log("Exporting data from the format "+format)
  const db=new sqlite3.Database('./data.db', sqlite3.OPEN_READONLY)
  await fs.mkdir(path.join(dir,format),{ recursive: true },(err)=>{if(err) {console.error("Folder creation for "+format+" failed");return}})
  db.all('SELECT replayData.*, t.url AS threadURL,t.threadName,t.threadRound FROM replayData JOIN fetchedThreads AS t ON fetchid=t.id WHERE format=="'+format+'" ORDER BY date DESC ',(err,rows)=>{
    if (err) {console.error(err.message);return}
    else {
      fs.writeFile(path.join(path.join(dir,format),'data.json'),JSON.stringify(rows), err => {if (err) {console.error(err);}})
      }
  })
  const formatList = await fs.readFileSync(path.join(dir,"format-list.txt"),{ encoding: 'utf8', flag: 'r' })
  if (!formatList.includes(format)) await fs.writeFileSync(path.join(dir,"format-list.txt"),formatList+","+format)
  db.close()
} 



////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//Test functions

// url="https://www.smogon.com/forums/threads/ancient-lower-tiers-premier-league-iv-replays.3776296/"
// SmogThreadImport(url,"ALTPL IV","")

// url="https://replay.pokemonshowdown.com/gen7ou-2000365211#/" //deleted replay
// url="https://replay.pokemonshowdown.com/smogtours-gen3ou-56583"
// const db=new sqlite3.Database('./data.db', sqlite3.OPEN_READWRITE)
// SingleReplayImport("https://replay.pokemonshowdown.com/smogtours-gen7ubers-692184",db,undefined,undefined,false).then(()=>db.close())


const warnedMessages = new Set();

function warnOnce(message) {
    if (!warnedMessages.has(message)) {
        console.warn(message);
        warnedMessages.add(message);
    }

}

useCSVFile()
async function useCSVFile(){
  const csv = await fs.readFileSync(path.join(__dirname, "listToImport.txt"),{ encoding: 'utf8', flag: 'r' }).split("\n").map(line=>line.replace("\r","").split(",")).filter(x=>x.length==3||x.length==2)
  for (infos of csv){
    console.log("Importing thread : "+infos[0])
    await SmogThreadImport(infos[0]+(infos[0].endsWith("/")?"":"/"),infos[1],infos[2]||"")
  }

}

let moveToZ
createZmoveDic()//.then(()=>useCSVFile())
async function createZmoveDic(){
  moveToZ={}
  let zmoveDic={
  "Fighting":"fightiniu-z",
  "Flying":"flyiniumz",
  "Fire":"firiumz",
  "Electric":"electriumz",
  "Fairy":"fairiumz",
  "Dark":"darkiniumz",
  "Ice":"iciumz",
  "Psychic":"psychiumz"
  }
  let text = await fs.readFileSync("./moves.ts",{ encoding: 'utf8', flag: 'r' })
  text.split(/\n(?!\t|\n)/).filter(x=>x.length>10).filter(x=>x.includes("isZ")||x.includes('category: "Status",')).forEach(move=>{
    let moveName=move.split("\n").filter(x=>x.includes("name: "))[0].split('"')[1]
    if (move.includes("isZ: ")) moveToZ[moveName]=move.split("\n").filter(x=>x.includes("isZ: "))[0].split('"')[1]
    else {
      let type=move.split("\n").filter(x=>x.includes("\ttype: "))[0].split('"')[1]
      moveToZ["Z-"+moveName]=zmoveDic[type]?zmoveDic[type]:(type.toLowerCase())+"iumz"
    }
  })
  Object.keys(moveToZ).forEach(x=>{if (!moveToZ[x].includes("-")) moveToZ[x]=moveToZ[x].slice(0,-1)+"-z"})
}

let monsToUpdate=["arceus","silvally","zacian","zamazenta","urshifu"]

// refreshData()
async function refreshData(){
  const { promisify } = require('util');
  const db=new sqlite3.Database('./data.db', sqlite3.OPEN_READWRITE)
  const dbAll = promisify(db.all).bind(db);
  const rows= await dbAll('SELECT url FROM replayData WHERE info1 LIKE "%mimikyu-busted%" OR info2 LIKE "%mimikyu-busted%"')
  console.log(rows.length)
  for (row of rows){
    await SingleReplayImport(row.url,db,undefined,undefined,true)
  }
  ["gen7ou","gen6ubers"].forEach(format=>exportData(format))
}

//redoJSONFiles()
async function redoJSONFiles(){
  const { promisify } = require('util');
  const db=new sqlite3.Database('./data.db', sqlite3.OPEN_READWRITE)
  const dbAll = promisify(db.all).bind(db);
  const rows= await dbAll('SELECT DISTINCT format FROM replayData')
  Object.values(rows).forEach(x=>exportData(x.format))

}
