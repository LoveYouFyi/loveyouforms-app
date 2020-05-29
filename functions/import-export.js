// DATABASE CREDENTIALS: so export-import can authenticate with the database
const serviceAccount = require('./service-account.json'); // download from firebase console
// FIRESTORE EXPORT-IMPORT
const firestoreService = require('firestore-export-import');
firestoreService.initializeApp(serviceAccount);
// FILE SYSTEM: performs file operations (create file containing exported data)
const fs = require('fs');


/*------------------------------------------------------------------------------
  Firestore Import Entire Database or a Single Collection
  run file import from command-line: 
  $ node -e 'require("./import-export").firestoreImport("./import-starter-database.json")'
------------------------------------------------------------------------------*/

module.exports.firestoreImport = jsonFile => {
  // The arrays for dates, locations, and reference fields are optional
  firestoreService.restore(jsonFile, {
    // for importing collections with refKey
    // refs: ['refKey', 'formSubmit'],
  });
}


/*------------------------------------------------------------------------------
  Firestore Export
  run export from command-line (creates file named exported.json)
  $ node -e 'require("./import-export").firestoreExport()'
------------------------------------------------------------------------------*/

// To get all collections provide empty array: .backups([])
// To get specific collections provide array: .backups(['app', 'field']) 
module.exports.firestoreExport = () => {
  firestoreService
    .backups([]) // Array of collection names is OPTIONAL
    .then((collections) => {
      // You can do whatever you want with collections
      // console.log(JSON.stringify(collections));
      console.log(collections);

      // stringify JSON Object
      var jsonContent = JSON.stringify(collections);
      // console.log(jsonContent);
      fs.writeFile("exported.json", jsonContent, 'utf8', function (err) {
        if (err) {
            console.log("An error occured while writing JSON Object to File.");
            return console.log(err);
        }
        console.log("JSON file has been saved.");
      });
      
    });
}
