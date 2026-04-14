require('dotenv').config();
const nayaxa = require('./src/services/nayaxaStandalone.js');

(async () => {
    console.log("Testing searchInternet for 'dasar hukum pelantikan bupati bogor 2025'...");
    let res = await nayaxa.searchInternet("dasar hukum pelantikan bupati bogor 2025");
    console.log(JSON.stringify(res, null, 2));
})();
