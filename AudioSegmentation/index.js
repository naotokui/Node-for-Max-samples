
const path = require('path');
const Max = require('max-api');
const onset = require('./onset.js');
var load = require('audio-loader')

Max.post(`Loaded the ${path.basename(__filename)} script`);

// Segmentation
Max.addHandler("segments", (filepath) => {
  // load file and process
  load(filepath).then(function (buffer) {
    peaks = onset.getOnsets(buffer);
    Max.outlet("segments", peaks);
  }).catch(function (err){
    Max.post(err);
  });
});

// Find a segment containing the given position
Max.addHandler("find_segment", (position) => {
  if (typeof peaks === "undefined"){
    Max.post("no segmentation data found");
    return;
  } else {
    for (let i =0; i < peaks.length - 1;i++){
      if (peaks[i] < position && position <= peaks[i+1]){
        Max.outlet("find_segment", peaks[i], peaks[i+1]);
        break;
      }
    }
  }
});