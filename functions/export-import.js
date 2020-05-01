// Firebase Admin SDK to access the Firebase/Firestore Realtime Database.
const admin = require('firebase-admin');
// Firebase admin credentials
const serviceAccount = require('./service-account.json'); // download from firebase console
//const serviceAccount = require('./service-account-love-you-forms.json'); // download from firebase console
admin.initializeApp({ // initialize firebase admin with credentials
  credential: admin.credential.cert(serviceAccount), // So functions can connect to database
  databaseURL: 'https://loveyou-forms.firebaseio.com' // Needed if using FireBase database (not FireStore)
});
// Firestore Export Import
const firestoreService = require('firestore-export-import');
firestoreService.initializeApp(serviceAccount);
// file system module to perform file operations
const fs = require('fs');

/**
 * Firestore Export
 * run export from command-line: $ node -e 'require("./export-import").firestoreExport()'
 * run import from command-line: $ node -e 'require("./export-import").firestoreImport()'
 */
// get all collections provide empty array: .backups([])
// get specific collections provide array: .backups(['app', 'field']) 
module.exports.firestoreExport = function () {
  firestoreService
    .backups([]) // Array of collection's name is OPTIONAL
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
  // [End] Firestore Export Import
}

module.exports.firestoreImport = function () {
  // The array of date, location and reference fields are optional
  firestoreService.restore('import-starter-database.json', {
    // for importing collections with refKey
    // refs: ['refKey', 'formSubmit'],
  });
}

module.exports.importCollection = function () {
  // The array of date, location and reference fields are optional
  firestoreService.restore('import-collection.json', {
    // for importing collections with refKey
    // refs: ['refKey', 'formSubmit'],
  });
}
