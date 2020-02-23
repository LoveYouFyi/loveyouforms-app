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
// Timestamp conversions
let moment = require('moment-timezone');
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

  let formFields = await db.collection('formFields').get();
  formFields.docs.map(doc => {
    console.log("formFields doc #### ", doc);
    console.log("formFields doc.data() #### ", doc.data());
  });

  // Form submitted data
  // FIXME update so template data fields are dynamic based on template used
  let { app: appKey, template = 'contactDefault', webformId, ...rest } 
    = req.body; // template default 'contactForm' if not added in webform
    console.log("these $$$$$$$$$$$$$$ ", rest);

  // Form Fields Sanitize
  // trim whitespace and limit character count
  let limit = (string, charCount) => string.trim().substr(0, charCount)
  appKey = limit(appKey, 256);
  template = limit(template, 64);
  webformId = limit(webformId, 64);
  let name = rest.name ? limit(rest.name, 64) : undefined;
  let phone = rest.phone ? limit(rest.phone, 64) : undefined;
  let email = rest.email ? limit(rest.email, 96) : undefined;
  let message = rest.message ? limit(rest.message, 1280) : undefined;

  // App identifying info
  let appInfoName, appInfoUrl, appInfoFrom;
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
    appKey,
    createdDateTime: FieldValue.serverTimestamp(),
    ...appInfoFrom && { from: appInfoFrom }, // from: app.(appKey).appInfo.from
    toUids: [ appKey ], // to: app.(appKey).email
    ...email && {replyTo: email}, // webform
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
    let snapshot = await db.collection('formSubmission').orderBy('createdDateTime', 'desc').get();

    snapshot.docs.map(doc => {
      // doc.data() is object -> { name: 'jax', email: 'jax@jax.com' }
      // FIXME update so template data fields are dynamic based on template used
      const { name, email, phone, message } = doc.data().template.data; 
      // date and time
      // FIXME get timezone from 'app' config so will post to excel
      let createdDateTime = doc.data().createdDateTime.toDate(); // toDate() is firebase method
      let createdDate = moment(createdDateTime).tz("America/New_York").format('L'); // Format date with moment.js
      let createdTime = moment(createdDateTime).tz("America/New_York").format('h:mm A z');

      return valueArray.push([createdDate, createdTime, name, email, phone, message]); 
    });

    let maxRange = valueArray.length + 1;

    // Do authorization
    await jwtClient.authorize();
    console.log("valueArray #### ", valueArray); 
    // Create Google Sheets request
    // FIXME make dynamic 'spreadsheetId' - pull from app
    // FIXME update 'range' to a generic spreadsheet tab name use for all apps
    let request = {
      auth: jwtClient,
      spreadsheetId: "1nOzYKj0Gr1zJPsZv-GhF00hUAJ2sTsCosMk4edJJ9nU",
      range: "Firestore!A2:F" + maxRange,
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

