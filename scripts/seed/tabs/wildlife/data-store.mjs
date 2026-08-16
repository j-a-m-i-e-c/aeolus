import { genSeries, noise } from "../../lib.mjs";
export const dataStore={
  tables:[
    {name:"wildlife-events",columns:[{name:"eventId",type:"string"},{name:"species",type:"string"},{name:"category",type:"string"},{name:"confidence",type:"number"}],rows:[]},
    {name:"nest-history",columns:[{name:"timestamp",type:"number"},{name:"temperature",type:"number"}],rows:genSeries(24,34.0,36.2).map((v,i)=>({timestamp:Date.now()-(23-i)*3600000,temperature:Number(noise(v,.18).toFixed(1))}))}
  ]
};
