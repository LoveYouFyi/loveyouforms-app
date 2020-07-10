/*------------------------------------------------------------------------------
  Dependencies all cloud functions
------------------------------------------------------------------------------*/

// Firebase Functions SDK: to create Cloud Functions and setup triggers
const functions = require('firebase-functions');
// Firebase Admin SDK: to interact with the Firestore database
//const admin = require('firebase-admin');
//admin.initializeApp(); // initialize firebase admin sdk without parameters
//admin.firestore().settings({ timestampsInSnapshots: true }); // to write server-timestamps to database docs
//const { admin } = require('./src/init.js');
// Environment Keys: see keys.public.js for comments, examples, and usage
const env = require('./../../env/keys.public.js');
//const context = { envKeys };

/*------------------------------------------------------------------------------
  Cloud Functions
------------------------------------------------------------------------------*/
const formHandler = require('./src/form-handler');
const firestoreToSheets = require('./src/firestore-to-sheets');
const schemaDefault = require('./src/schema-default');


/*-- Form-Handler HTTP Cloud Function ----------------------------------------*/
module.exports.formHandler = functions.https.onRequest(formHandler(env));


/*-- Firestore-to-Sheets Trigger Cloud Function ------------------------------*/
module.exports.firestoreToSheets = functions.firestore.document('submitForm/{formId}')
  .onCreate(firestoreToSheets(env));


/*-- Schema-Default Trigger Cloud Functions ----------------------------------*/

// 'app' collection default schema function
module.exports.schemaApp = functions.firestore.document('app/{id}')
  .onCreate(schemaDefault('app', 'schemaApp', env));

// 'formTemplate' collection default schema function
module.exports.schemaFormTemplate = functions.firestore.document('formTemplate/{id}')
  .onCreate(schemaDefault('formTemplate', 'schemaFormTemplate', env));
