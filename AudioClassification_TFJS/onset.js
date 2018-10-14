
const dsp = require('./dsp.js');

// Get onsets based on changes in spectrum flux
function getOnsets(samples, min_length = 100){

  // Get a buffer of samples from the left channel
  var bufferSamples = samples.getChannelData(0);

  const THRESHOLD_WINDOW_SIZE = 10;
  const MULTIPLIER            = 1.5; //1.5; TODO: find the best threshold
  const SAMPLE_SIZE           = 1024;
  const FFT2SIZE              = 1024;

  var sampleRate = samples.sampleRate;

  var fft  = new dsp.FFT(SAMPLE_SIZE, sampleRate);
  var fft2 = new dsp.FFT(FFT2SIZE,    sampleRate / SAMPLE_SIZE);
  var spectrum     = new Float32Array(SAMPLE_SIZE / 2);
  var prevSpectrum = new Float32Array(SAMPLE_SIZE / 2);
  var prunnedSpectralFlux = [];
  var splitSamples = [];
  var spectralFlux = [];
  var threshold    = [];
  var peaks        = [];
  var peakFreq     = [];

  // Split samples into arrays of 1024
  for (let i = 0; i < bufferSamples.length; i += SAMPLE_SIZE) {
    splitSamples.push(bufferSamples.slice(i, i + SAMPLE_SIZE));
  }

  // Calculate a spectral flux value for each sample range in the song
  for (let i = 0; i < splitSamples.length; i++) {
    // Samples must fill the full size to ensure a power of two for the FFT
    if (splitSamples[i].length !== SAMPLE_SIZE) break;

    // Copy the current spectrum values into the previous
    for (let j = 0; j < spectrum.length; j++) {
      prevSpectrum[j] = spectrum[j];
    }

    // Apply the Hamming function to clean up the audio signal
    //var windowFunction = new WindowFunction(WindowFunction.HAMMING);
    //var result = windowFunction.process(length, index);

    // Update the current spectrum with the FFT bins for this sample range
    fft.forward(splitSamples[i]);
    spectrum = fft.spectrum;

    // Spectral flux is the sum of all increasing (positive) differences in each bin and its corresponding bin from the previous sample
    var flux = 0;

    // Caring only about rising matching bin deltas between this and the previous spectrum, sum all positive deltas to calculate total flux
    for (let bin = 0; bin < spectrum.length; bin++) {
      flux += Math.max(0, spectrum[bin] - prevSpectrum[bin]);
    }

    // Save the calculated flux for this sample range
    spectralFlux.push(flux);
  }

  // Calculate threshold values by averaging the range of flux values
  for (let i = 0; i < spectralFlux.length; i++) {
    // Determine the start and end indexes of the spectral flux for this iteration's window range
    var start = Math.max(0, i - THRESHOLD_WINDOW_SIZE);
    var end = Math.min(spectralFlux.length - 1, i + THRESHOLD_WINDOW_SIZE);

    // Sum all the spectral flux values in this range
    var sum = 0;
    for (let flux = start; flux <= end; flux++) {
      sum += spectralFlux[flux];
    }

    // Save the calculated threshold value for this averaging window range
    threshold.push(sum / (end - start) * MULTIPLIER);
  }

  // Calculate pruned flux values where the spectral flux exceeds the averaged threshold
  for (let i = 0; i < threshold.length; i++) {
    // Save either zero or the difference from threshold to flux if positive
    prunnedSpectralFlux.push(Math.max(0, spectralFlux[i] - threshold[i]));
  }

  // Remove all but the peaks of pruned spectral flux values, setting all else to zero
  var peaks_ = [];
  for (let i = 0; i < prunnedSpectralFlux.length - 1; i++) {
    if (prunnedSpectralFlux[i] > prunnedSpectralFlux[i + 1]) {
      // This is higher than the next value, so save it
      peaks_.push(prunnedSpectralFlux[i]);
    } else {
      // This is lower than the next value, so drop it to zero
      peaks_.push(0);
    }
  }

  // Convert frames -> seconds
  var prevOnset = 0.0;
  peaks.push(0.0); // add the start of the file
  for (let i = 1; i < peaks_.length - 1; i++) {
    if (peaks_[i] > 0 && peaks_[i-1] == 0) { // avoid onset right after another onset
      var onset = i * SAMPLE_SIZE / sampleRate * 1000.; // in milli seconds
      if (onset - prevOnset > min_length){
        peaks.push(onset);
        prevOnset = onset;
      }
    }
  }
  peaks.push(samples.duration); // add the end of file

  return peaks;
}

exports.getOnsets = getOnsets;