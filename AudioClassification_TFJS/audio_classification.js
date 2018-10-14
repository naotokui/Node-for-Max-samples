const context = require('audio-context')()
const dsp = require('./dsp.js');
// const p5 = require('p5');

const MIN_DB = -80.0;
exports.MIN_DB = MIN_DB;

// Strip audio buffer and make it mono
function sliceAudioBufferInMono(buffer, start_sec, end_sec){   
   if (start_sec > end_sec || end_sec > buffer.duration || start_sec < 0){
      print("error: check start_sec/end_sec/buffer.duration");
      return buffer;
   }

   var sampleRate = buffer.sampleRate;
   var numSamples = (end_sec - start_sec) * sampleRate;
   var startOffset = Math.floor(start_sec * sampleRate);

   var o = createContext({offline: true, sampleRate: sampleRate, length: numSamples});
//    var o = new OfflineAudioContext(1, numSamples, sampleRate);
   var newBuffer = o.createBuffer(1, numSamples, sampleRate);

   // Temp array
   var array = new Float32Array(numSamples);
   buffer.copyFromChannel(array, 0, startOffset);
   newBuffer.copyToChannel(array, 0, 0);
   return newBuffer;
}
exports.sliceAudioBufferInMono = sliceAudioBufferInMono;

// Create spectrogram
// returnsImage: flag to return a p5 Image
function createSpectrogram(buffer, startMS, endMS, fftSize = 1024, hopSize = 256, melCount=96, returnsImage = false){
    const channelOne = buffer.getChannelData(0);  // use only the first channel
    const sampleRate = buffer.sampleRate;
    const db_spectrogram = [];
 
    // Create a fft object. Here we use default "Hanning" window function
    const fft = new dsp.FFT(fftSize, sampleRate); 
 
    // Mel Filterbanks
    var melFilterbanks = constructMelFilterBank(fftSize/2, melCount, 
                                                lowF=0, highF=sampleRate/2, sr=sampleRate);
 
    // Segment 
    let currentOffset = startMS / 1000. * sampleRate;
    let endSample = endMS /1000. * sampleRate;
 
    var maxdb = -100;
    while (currentOffset + fftSize < endSample) {
       const segment = channelOne.slice(currentOffset, currentOffset + fftSize); 
       fft.forward(segment);  // generate spectrum for this segment
       let spectrum = fft.spectrum.map(x => x * x); // should be power spectrum!
 
       const melspec = applyFilterbank(spectrum, melFilterbanks);
 
       for (let j = 0; j < melCount; j++) {
          melspec[j] += 0.000000001; // avoid minus infinity
       }
 
       const decibels = new Float32Array(melCount); 
       for (let j = 0; j < melCount; j++) {
          // array[j]    = Math.max(-255, Math.log10(melspec[j]) * 100);  // for drawing  
          db = 10 * Math.log10(melspec[j]);
          decibels[j] = db;               
          if (db > maxdb) maxdb  = db;
       }
       db_spectrogram.push(decibels);
       currentOffset += hopSize;
    }
    for (let i=0; i < db_spectrogram.length; i++){
       for (let j = 0; j < melCount; j++){
          db_spectrogram[i][j]  -= maxdb;
       }
    }
 
    return db_spectrogram;
 }
 
exports.createSpectrogram = createSpectrogram;

// Resample audiobuffer using OfflineAudioContext
// https://gist.github.com/jhiswin/b88ecf7900b76810429b
function resampleBuffer( inBuffer, inNumSamples, inSampleRate, outSampleRate, callback){
    var o = new OfflineAudioContext(1, inNumSamples, outSampleRate);
 
    // create audio buffer
    var b = o.createBuffer(1, inNumSamples, inSampleRate);
 
    // copy data
    var buf = b.getChannelData(0);
    for (var i = 0; i < inNumSamples; i++) {
       buf[i] = inBuffer.getChannelData(0)[i];
    }
 
    /* Play it from the beginning. */
    var source = o.createBufferSource();
    source.buffer = b;
    source.connect(o.destination);
    source.start(0);
 
    /* Start rendering as fast as the machine can. */
    o.startRendering().then(function(renderedBuffer) {
       callback(renderedBuffer);
    }).catch(function(err) {
       console.log('Rendering failed: ' + err);
    });
 }

 // This implementation of MelFilterBank is based on:
 // https://github.com/vail-systems/node-mfcc/blob/master/src/mfcc.js
 function constructMelFilterBank(fftSize, nFilters, lowF, highF, sr) {
    var bins = [],
        fq = [],
        filters = [];
 
    var lowM = hzToMels(lowF),
        highM = hzToMels(highF),
        deltaM = (highM - lowM) / (nFilters+1);
 
    // Construct equidistant Mel values between lowM and highM.
    for (var i = 0; i < nFilters; i++) {
       // Get the Mel value and convert back to frequency.
       // e.g. 200 hz <=> 401.25 Mel
       fq[i] = melsToHz(lowM + (i * deltaM));
 
       // Round the frequency we derived from the Mel-scale to the nearest actual FFT bin that we have.
       // For example, in a 64 sample FFT for 8khz audio we have 32 bins from 0-8khz evenly spaced.
       bins[i] = Math.floor((fftSize+1) * fq[i] / (sr/2));
    }
 
    // Construct one cone filter per bin.
    // Filters end up looking similar to [... 0, 0, 0.33, 0.66, 1.0, 0.66, 0.33, 0, 0...]
    for (var i = 0; i < bins.length; i++)
    {
       filters[i] = [];
       var filterRange = (i != bins.length-1) ? bins[i+1] - bins[i] : bins[i] - bins[i-1];
       filters[i].filterRange = filterRange;
       for (var f = 0; f < fftSize; f++) {
          // Right, outside of cone
          if (f > bins[i] + filterRange) filters[i][f] = 0.0;
          // Right edge of cone
          else if (f > bins[i]) filters[i][f] = 1.0 - ((f - bins[i]) / filterRange);
          // Peak of cone
          else if (f == bins[i]) filters[i][f] = 1.0;
          // Left edge of cone
          else if (f >= bins[i] - filterRange) filters[i][f] = 1.0 - (bins[i] - f) / filterRange;
          // Left, outside of cone
          else filters[i][f] = 0.0;
       }
    }
 
    // Store for debugging.
    filters.bins = bins;
 
    // Here we actually apply the filters one by one. Then we add up the results of each applied filter
    // to get the estimated power contained within that Mel-scale bin.
    //
    // First argument is expected to be the result of the frequencies passed to the powerSpectrum
    // method.
    return filters;
 }
 
//  Utility
function sum(array) {
    return array.reduce(function(a, b) { return a + b; });
 }
 
 function melsToHz(mels) {
    return 700 * (Math.exp(mels / 1127) - 1);
 }
 
 function hzToMels(hertz) {
    return 1127 * Math.log(1 + hertz/700);
 }

 function  applyWindow(buffer, win) {
    let out = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
       out[i] = win[i] * buffer[i];
    }
    return out;
 }

 function applyFilterbank(spectrum, filterbank) {
    if (spectrum.length != filterbank[0].length) {
       console.error(`Each entry in filterbank should have dimensions matching
 FFT. |FFT| = ${spectrum.length}, |filterbank[0]| = ${filterbank[0].length}.`);
       return;
    }
 
    // Apply each filter to the whole FFT signal to get one value.
    let out = new Float32Array(filterbank.length);
    for (let i = 0; i < filterbank.length; i++) {
       const win = applyWindow(spectrum, filterbank[i]);
       out[i] = sum(win);
    }
    return out;
 }