const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');

const wb = XLSX.readFile('/Users/colekannam/Documents/JHU VC DATABASE/JHU_VC_Network.xlsx');
const ws = wb.Sheets['JHU VC Network'];
const rows = XLSX.utils.sheet_to_json(ws);

const connections = rows
  .filter(r => r['Firm'] && r['Name'])
  .map(r => ({
    name:       (r['Name'] || '').trim(),
    firm:       (r['Firm'] || '').trim(),
    connection: (r['Connection to Johns Hopkins'] || '').trim(),
    role:       (r['Role at Firm'] || '').trim(),
    entityType: (r['Entity Type'] || '').trim(),
  }));

const outPath = path.join(__dirname, '../data/jhu_connections.json');
fs.writeFileSync(outPath, JSON.stringify(connections, null, 2));
console.log(`Wrote ${connections.length} connections to data/jhu_connections.json`);
