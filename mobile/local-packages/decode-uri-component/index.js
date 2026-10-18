'use strict';

// Stands in for decode-uri-component 0.2.x: same output for valid input, one pass over broken escapes (GHSA-vcc3-ghjq-m6fr).
const ESCAPES = /^(?:%[0-9a-fA-F]{2})+$/;
const LONGEST_UTF8 = 4;

function decodeLoose(input) {
  let out = '';
  let i = 0;
  while (i < input.length) {
    if (input[i] !== '%') {
      out += input[i];
      i++;
      continue;
    }
    let decoded = false;
    for (let bytes = LONGEST_UTF8; bytes >= 1 && !decoded; bytes--) {
      const chunk = input.slice(i, i + bytes * 3);
      if (chunk.length !== bytes * 3 || !ESCAPES.test(chunk)) continue;
      try {
        out += decodeURIComponent(chunk);
        i += chunk.length;
        decoded = true;
      } catch {
        // Not a whole character at this length, so try a shorter one.
      }
    }
    if (decoded) continue;
    if (input.startsWith('%FE%FF', i) || input.startsWith('%FF%FE', i)) {
      out += '��';
      i += 6;
    } else if (input.startsWith('%C2', i)) {
      out += '�';
      i += 3;
    } else {
      out += '%';
      i++;
    }
  }
  return out;
}

module.exports = function decodeUriComponent(encodedURI) {
  if (typeof encodedURI !== 'string') {
    throw new TypeError('Expected `encodedURI` to be of type `string`, got `' + typeof encodedURI + '`');
  }
  const input = encodedURI.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(input);
  } catch {
    return decodeLoose(input);
  }
};
