// SECTION Requirements

// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');
// The Firebase Admin SDK to access the Firebase Realtime Database.
var admin = require("firebase-admin");
var serviceAccount = require("./service-account.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://sheet-sync-fd542.firebaseio.com"
});
// Firestore db reference
let db = admin.firestore();
// Required for timestamps settings
let FieldValue = require('firebase-admin').firestore.FieldValue; // Timestamp Here
const settings = { timestampsInSnapshots: true};
db.settings(settings);
// Google Sheets instance
const { google } = require("googleapis");
const sheets = google.sheets("v4");
// Create JWT Authentication
const jwtClient = new google.auth.JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"] // read and write sheets
});

// !SECTION


// ANCHOR Form Handler
exports.formHandler = functions.https.onRequest(async (req, res) => {
  //
  // Get webform submitted data
  //
  let { app: appKey, template = 'contactDefault', webformId, name, phone, email, message } 
    = req.body; // template default 'contactForm' if not added in webform
  //
  // Sanitize webform data: trim whitespace and limit character count
  let limit = (string, charCount) => string.trim().substr(0, charCount)
  //
  appKey = limit(appKey, 256);
  template = limit(template, 64);
  webformId = limit(webformId, 64);
  name = limit(name, 64);
  phone = limit(phone, 64);
  email = limit(email, 96);
  message = limit(message, 1280);

  //
  // Declare vars for data to be retrieved from db
  let appInfoName, appInfoUrl, appInfoFrom;
  //
  // Retrieve data from db and assign to above vars
  const appInfoRef = db.collection('app').doc(appKey);
  await appInfoRef.get()
    .then(doc => {
      if (!doc.exists) {
        res.end();
      } else {
        // destructure from doc.data().appInfo --> name, url, from 
        // and assign to previously declared vars
        ( { name: appInfoName, url: appInfoUrl, from: appInfoFrom } 
           = doc.data().appInfo );
      }
    })
    .catch(err => {
      console.log('Error getting document', err);
    });

  // Build object to be saved to db
  let data = {
    // spread operator conditionally adds, otherwise function errors if not exist
    // 'from' email if not assigned comes from firebase extension field: DEFAULT_FROM
    ...appInfoFrom && { from: appInfoFrom }, // from: app.(appKey).appInfo.from
    createdDateTime: FieldValue.serverTimestamp(),
    toUids: [ appKey ], // to: app.(appKey).email
    replyTo: email, // webform
    ...webformId && { webformId }, // webform
    template: {
      name: template,
      data: {
        ...appInfoName && { appInfoName }, // app.(appKey).appInfo.name
        ...appInfoUrl && { appInfoUrl }, // app.(appKey).appinfo.url
        ...name && { name }, // webform
        ...phone && { phone }, // webform
        ...email &&  { email }, // webform
        ...message && { message } // webform
      }
    }
  };

  // So serverTimestamp works must first create new doc key then post data
  let newKey = db.collection("formSubmission").doc();
  // update the new-key-record using 'set' which works for existing doc
  newKey.set(data);

  return res.send({
    // return empty success response, so client can finish AJAX success
  });

});


// ANCHOR - Firestore To Sheets [Nested email template data]
exports.firestoreToSheet = functions.firestore.document('formSubmission/{formId}').onWrite(async () => {
  try {

    let valueArray = [];
    // FIXME update query to get only specific app's data
    let snapshot = await db.collection('formSubmission').get();

    // FIXME get date form submitted & sort it
    snapshot.docs.map(doc => {
      // doc.data() is object -> { name: 'jax', email: 'jax@jax.com' }
      const { name, email } = doc.data().template.data; 
      const { created } = doc.data().created; 
      // Sheets expects array of arrays, push as array to valueArray
      return valueArray.push([created, name, email]); 
    });

    let maxRange = valueArray.length + 1;

    // Do authorization
    await jwtClient.authorize();
    
    // Create Google Sheets request
    // FIXME make dynamic 'spreadsheetId' - pull from app
    // FIXME update 'range' to a generic spreadsheet tab name use for all apps
    let request = {
      auth: jwtClient,
      spreadsheetId: "1nOzYKj0Gr1zJPsZv-GhF00hUAJ2sTsCosMk4edJJ9nU",
      range: "Firestore!A2:B" + maxRange,
      valueInputOption: "RAW",
      requestBody: {
        values: valueArray
      }
    };
  
    // Update Google Sheets Data
    await sheets.spreadsheets.values.update(request, {});

  }
  catch(err) {
    console.log(err);
  }

});


// ANCHOR Firebase to Sheets [Basic 2 Column List]
exports.firebaseToSheet = functions.database.ref("/Form").onUpdate(async change => {
  let data = change.after.val();
  console.log("data ################ ", data);
  // Convert JSON to Array following structure below
  //
  //[
  //  ['COL-A', 'COL-B'],
  //  ['COL-A', 'COL-B']
  //]
  //
  var itemArray = [];
  var valueArray = [];
  Object.keys(data).forEach((key, index) => {
    itemArray.push(key);
    itemArray.push(data[key]);
    console.log("itemArray ############################# ", itemArray);
    valueArray[index] = itemArray;
    itemArray = [];
  });

  let maxRange = valueArray.length + 1;

  // Do authorization
  await jwtClient.authorize();
  console.log("valueArray ############################# ", valueArray) 

  // Create Google Sheets request
  let request = {
    auth: jwtClient,
    spreadsheetId: "1nOzYKj0Gr1zJPsZv-GhF00hUAJ2sTsCosMk4edJJ9nU",
    range: "Firebase!A2:B" + maxRange,
    valueInputOption: "RAW",
    requestBody: {
      values: valueArray
    }
  };
  
  // Update data to Google Sheets
  await sheets.spreadsheets.values.update(request, {});
});

