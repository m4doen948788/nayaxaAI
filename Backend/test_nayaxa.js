require('dotenv').config();
const nayaxa = require('./src/services/nayaxaStandalone.js');

(async () => {
    console.log("Testing searchInternet for 'cari di internet sammy lugina'...");
    let res = await nayaxa.searchInternet("cari di internet sammy lugina");
    console.log(JSON.stringify(res, null, 2));
})();
