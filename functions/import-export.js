// FIREBASE ADMIN SDK: to interact with the Firestore (or firebase) database
const admin = require('firebase-admin');
// DATABASE CREDENTIALS: so cloud functions can authenticate with the database
const serviceAccount = require('./service-account.json'); // download from firebase console
//admin.initializeApp({ // initialize firebase admin with credentials
  //credential: admin.credential.cert(serviceAccount), // So functions can connect to database
  //databaseURL: 'https://loveyou-forms.firebaseio.com'
//});
// FIRESTORE EXPORT-IMPORT
const firestoreService = require('firestore-export-import');
firestoreService.initializeApp(serviceAccount);
// FILE SYSTEM: performs file operations (create file containing exported data)
const fs = require('fs');


/*------------------------------------------------------------------------------
  Firestore Import
  run import from command-line: 
  $ node -e 'require("./import-export").firestoreImport()'
------------------------------------------------------------------------------*/

module.exports.firestoreImport = function () {
  // The array of date, location and reference fields are optional
  firestoreService.restore('import-starter-database.json', {
    // for importing collections with refKey
    // refs: ['refKey', 'formSubmit'],
  });
}


/*------------------------------------------------------------------------------
  Firestore Export
  run export from command-line: 
  $ node -e 'require("./import-export").firestoreExport()'
------------------------------------------------------------------------------*/

// To get all collections provide empty array: .backups([])
// To get specific collections provide array: .backups(['app', 'field']) 
module.exports.firestoreExport = function () {
  firestoreService
    .backups([]) // Array of collection names is OPTIONAL
    .then((collections) => {
      // You can do whatever you want with collections
      // console.log(JSON.stringify(collections));
      console.log(collections);

      // stringify JSON Object
      var jsonContent = JSON.stringify(collections);
      console.log(jsonContent);
      fs.writeFile("exported.json", jsonContent, 'utf8', function (err) {
        if (err) {
            console.log("An error occured while writing JSON Object to File.");
            return console.log(err);
        }
        console.log("JSON file has been saved.");
      });
      
    });
}


/*------------------------------------------------------------------------------
  Firestore Import Collection Only
  run import from command-line: 
  $ node -e 'require("./import-export").importCollection()'
------------------------------------------------------------------------------*/

module.exports.importCollection = function () {
  // 1) set the json file name to import 
  // 2) The array of date, location and reference fields are optional
  firestoreService.restore('import-collection.json', {
    // for importing collections with refKey
    // refs: ['refKey', 'formSubmit'],
  });
}
