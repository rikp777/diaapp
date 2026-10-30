// Generates the test media in a temporary directory (never in the repo).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' });
}

function png(file, size, color) {
  ffmpeg(['-f', 'lavfi', '-i', `color=c=${color}:s=${size}`, '-frames:v', '1', file]);
}

module.exports = async () => {
  // De Windows-test (windows.spec.js) maakt zijn eigen foto's en heeft geen ffmpeg nodig
  if (process.env.DIASHOW_GEEN_MEDIA) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diashow-media-'));

  // Different aspect ratios; names exercise natural sort (foto2 before foto10).
  png(path.join(dir, 'foto1.png'), '640x480', 'red');
  png(path.join(dir, 'foto2.png'), '480x640', 'green');
  png(path.join(dir, 'foto10.png'), '1280x400', 'blue');

  // 2-second WebM with a silent audio track. Named "video" so that it sorts
  // after the foto* files ("clip" would sort first alphabetically).
  const video = path.join(dir, 'video.webm');
  try {
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-t', '2', '-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libopus', '-shortest', video]);
  } catch {
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25',
      '-t', '2', '-c:v', 'libvpx', '-b:v', '200k', video]);
  }

  // Portrait (staand) video, like a phone video, for the fill test.
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=240x320:rate=25',
    '-t', '2', '-c:v', 'libvpx', '-b:v', '200k', path.join(dir, 'staand.webm')]);

  // JPG-foto's voor tekst en draaien (metadata): zonder EXIF, en als "camerafoto"
  const { withCameraExif } = require('./jpeg-tools');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x480', '-frames:v', '1', '-q:v', '4', path.join(dir, 'zonder-exif.jpg')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=160x120', '-frames:v', '1', '-q:v', '8', path.join(dir, 'thumb.jpg')]);
  const plain = fs.readFileSync(path.join(dir, 'zonder-exif.jpg'));
  fs.writeFileSync(path.join(dir, 'canon.jpg'), withCameraExif(plain, { le: true }));
  fs.writeFileSync(path.join(dir, 'nikon.jpg'), withCameraExif(plain, { le: false, thumbnail: fs.readFileSync(path.join(dir, 'thumb.jpg')) }));

  // Unsupported files.
  fs.writeFileSync(path.join(dir, 'kapot.heic'), crypto.randomBytes(4096));
  fs.writeFileSync(path.join(dir, 'notitie.txt'), 'Dit is geen foto.\n');

  // 60 small images for the thumbnail grid and memory-window tests.
  const many = path.join(dir, 'many');
  fs.mkdirSync(many);
  const small = path.join(dir, 'small.png');
  png(small, '64x48', 'orange');
  for (let i = 1; i <= 60; i++) fs.copyFileSync(small, path.join(many, `p${i}.png`));

  process.env.DIASHOW_MEDIA = dir;
  return async () => { fs.rmSync(dir, { recursive: true, force: true }); };
};
