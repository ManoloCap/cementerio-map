import fs from 'fs';

const pointsPath = 'c:/Users/manol/Lolo/CodeProjects/Cementerio/Map/src/components/cemetery_points.json';
const points = JSON.parse(fs.readFileSync(pointsPath, 'utf8'));

const allPanoramas = {};
const duplicates = [];

Object.keys(points).forEach(areaKey => {
  points[areaKey].forEach(p => {
    const filename = p.panorama.split('/').pop();
    if (allPanoramas[filename]) {
      duplicates.push({
        filename,
        originalArea: allPanoramas[filename],
        duplicateArea: areaKey,
        originalId: p.id
      });
    } else {
      allPanoramas[filename] = areaKey;
    }
  });
});

console.log(`Scanning completed. Found ${duplicates.length} duplicates.`);
if (duplicates.length > 0) {
  console.log('Duplicates detail:', JSON.stringify(duplicates, null, 2));
}
