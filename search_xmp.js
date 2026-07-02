import fs from 'fs';

const file1 = 'c:/Users/manol/Lolo/CodeProjects/Cementerio/Map/public/incoming_quickshare/dji_mimo_20260620_144026_0_1781988176914_photo.jpg';
const file2 = 'c:/Users/manol/Lolo/CodeProjects/Cementerio/Map/public/map_images/AREA3/CAM_20260620151042_0116_D.JPG';

function searchMetadata(filePath) {
  console.log(`=== Searching in ${filePath} ===`);
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Find all occurrences of GPano or DJI metadata tags
  const matches = content.match(/GPano:[A-Za-z0-9]+/g);
  if (matches) {
    console.log('GPano matches:', [...new Set(matches)]);
  } else {
    console.log('No GPano matches');
  }

  const djiMatches = content.match(/dji:[A-Za-z0-9]+/g);
  if (djiMatches) {
    console.log('DJI matches:', [...new Set(djiMatches)]);
  } else {
    console.log('No DJI matches');
  }
  
  // Let's print anything between <x:xmpmeta> and </x:xmpmeta>
  const xmpStart = content.indexOf('<x:xmpmeta');
  const xmpEnd = content.indexOf('</x:xmpmeta>');
  if (xmpStart !== -1 && xmpEnd !== -1) {
    console.log('XMP Meta content length:', xmpEnd - xmpStart);
    const xmpContent = content.substring(xmpStart, xmpEnd + 12);
    // Print lines containing yaw, pitch, roll, heading, pose or direction
    const lines = xmpContent.split('\n');
    const relevant = lines.filter(l => /yaw|pitch|roll|heading|pose|direction|coord|lat|long/i.test(l));
    console.log('Relevant XMP lines:');
    console.log(relevant.join('\n'));
  }
}

searchMetadata(file1);
searchMetadata(file2);
