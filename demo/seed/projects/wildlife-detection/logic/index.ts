// wildlife-detection — Automation Project logic
// The compiler wraps this module in Aeolus' execution/completion machinery.

export default async function run(context: EventContext) {
      var topic=String(context.topic||""); var evt=topic.split("/").pop();
      function byTopic(wanted){return devices.list().find(function(d){return d.topic===wanted;});}
      function n(device,field,fallback){var v=Number(device&&device.state&&device.state[field]);return isNaN(v)?fallback:v;}
      function setAction(label){state.set("lastAction",{label:label,at:Date.now()});}
      function project(){
        var camera=byTopic("sensor/wildlife/camera"), detection=byTopic("sensor/wildlife/detection"), power=byTopic("sensor/wildlife/site-power"), den=byTopic("sensor/wildlife/nest");
        var ds=detection&&detection.state?detection.state:{}; var cs=camera&&camera.state?camera.state:{}; var ps=power&&power.state?power.state:{}; var ns=den&&den.state?den.state:{};
        state.set("cameraOnline",cs.online!==false); state.set("accelerator",String(cs.accelerator||"Hailo-8L")); state.set("fps",n(camera,"fps",30)); state.set("inferenceMs",n(camera,"inferenceMs",17)); state.set("framesToday",n(camera,"framesToday",18432));
        state.set("species",String(ds.species||"ringtail-possum")); state.set("label",String(ds.label||"Ringtail Possum")); state.set("category",String(ds.category||"native")); state.set("confidence",n(detection,"confidence",.91)); state.set("distanceM",n(detection,"distanceM",7.2)); state.set("direction",String(ds.direction||"east")); state.set("detectedAt",n(detection,"ts",Date.now()-16000));
        state.set("battery",n(power,"battery",87)); state.set("solarW",n(power,"solarW",41)); state.set("nodeW",n(power,"nodeW",8.4));
        state.set("denOccupied",ns.occupied!==false); state.set("denAdultPresent",Boolean(ns.adultPresent)); state.set("denJoeys",n(den,"joeys",2)); state.set("denTemp",n(den,"temp",31.8));
        var eventId=String(ds.eventId||""); var previous=String(state.get("lastEventId")||"");
        if(eventId&&eventId!==previous){
          state.set("lastEventId",eventId); var total=Number(state.get("detectionsToday")||47)+1; var nativeCount=Number(state.get("nativeToday")||39); var predatorCount=Number(state.get("predatorsToday")||8);
          if(String(ds.category)==="native") nativeCount+=1; else if(String(ds.category)==="predator") predatorCount+=1;
          state.set("detectionsToday",total); state.set("nativeToday",nativeCount); state.set("predatorsToday",predatorCount);
          setAction(String(ds.label||"Wildlife")+" classified locally · "+Math.round(n(detection,"confidence",0)*100)+"% confidence");
          events.emit("wildlife/detection/classified",{eventId:eventId,species:String(ds.species||"unknown"),label:String(ds.label||"Unknown"),category:String(ds.category||"unknown"),confidence:n(detection,"confidence",0),distanceM:n(detection,"distanceM",0),ts:n(detection,"ts",Date.now())});
          try{if(db)db.write("wildlife-events",{eventId:eventId,species:String(ds.label||"Unknown"),category:String(ds.category||"unknown"),confidence:n(detection,"confidence",0)});}catch(e){}
        }
      }
      if(topic.indexOf("ui/")===0){
        if(evt==="simulate-native") events.emit("wildlife/sim/native-detection",{});
        else if(evt==="simulate-fox") events.emit("wildlife/sim/fox-detection",{});
        else if(evt==="simulate-cat") events.emit("wildlife/sim/cat-detection",{});
        else if(evt==="reset-wildlife") {events.emit("wildlife/sim/reset",{});setAction("Resetting edge station to dusk conditions");}
        return;
      }
      if(topic.indexOf("sensor/wildlife/")!==0)return; project();
}
