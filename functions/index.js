// SECTION Requirements

// Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');
// Firebase Admin SDK to access the Firebase/Firestore Realtime Database.
var admin = require("firebase-admin");
var serviceAccount = require("./service-account.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://loveyou-forms.firebaseio.com" // FireBase db (not fireStore)
});
let db = admin.firestore(); // Firestore db reference
// Timestamps: required for timestamp settings
let FieldValue = require('firebase-admin').firestore.FieldValue; // Timestamp Here
const settings = { timestampsInSnapshots: true};
db.settings(settings);
let moment = require('moment-timezone'); // Timestamp formats and timezones
// Google Sheets
const { google } = require("googleapis");
const sheets = google.sheets("v4");
// JWT Authentication (for google sheets)
const jwtClient = new google.auth.JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"] // read and write sheets
});
// CORS: to allow cross origin requests for XMLHttpRequest/Ajax
const cors = require('cors')({origin: true});

// !SECTION

////////////////////////////////////////////////////////////////////////////////
// HTTP Cloud Functions
////////////////////////////////////////////////////////////////////////////////

// Terminate HTTP functions with res.redirect(), res.send(), or res.end().
// Terminate a synchronous function with a return; statement.
// https://firebase.google.com/docs/functions/terminate-functions

// ANCHOR Form Handler
exports.formHandler = functions.https.onRequest(async (req, res) => {

  try {
    // Form submitted data
    let { app: appKey, template = 'contactDefault', webformId, ...rest } 
      = req.body; // template default 'contactForm' if not added in webform

    // Sanitize data
    let sanitizedData = {};
    function sanitize(string, charCount) { return string.trim().substr(0, charCount) };

    let formFields = await db.collection('formField').get();
    // webform-submitted fields
    for (const doc of formFields.docs) {
      let maxLength = await doc.data().maxLength;
      // ...rest -> first check if field exists in req.body ...rest
      if (rest[doc.id]) {
        let string = sanitize(rest[doc.id], maxLength);
        sanitizedData[doc.id] = string;
      } else if (doc.id == 'appKey') {
        appKey = sanitize(appKey, maxLength);
      } else if (doc.id == 'template') {
        template = sanitize(template, maxLength);
      } else if (doc.id == 'webformId') {
        webformId = sanitize(webformId, maxLength);
      }
    }

    // App identifying info
    let appInfoName, appInfoUrl, appInfoFrom;
    const appDoc = await db.collection('app').doc(appKey).get();
    // destructure and assign:
    ( { name: appInfoName, url: appInfoUrl, from: appInfoFrom, timeZone: appInfoTimeZone } 
      = appDoc.data().appInfo );
    // assign to previously declared vars
    sanitizedData.appInfoName = appInfoName;
    sanitizedData.appInfoUrl = appInfoUrl;
    sanitizedData.appInfoTimeZone = appInfoTimeZone;

    // Build object to be saved to db
    let data = {
      // spread operator conditionally adds, otherwise function errors if not exist
      // 'from' email if not assigned comes from firebase extension field: DEFAULT_FROM
      appKey,
      createdDateTime: FieldValue.serverTimestamp(),
      ...appInfoFrom && { from: appInfoFrom }, // from: app.(appKey).appInfo.from
      toUids: [ appKey ], // to: app.(appKey).email
      ...sanitizedData.email && {replyTo: sanitizedData.email}, // webform
      ...webformId && { webformId }, // webform
      template: {
        name: template,
        data: sanitizedData
      }
    };

    // So serverTimestamp works must first create new doc key then post data
    let newKey = db.collection("formSubmission").doc();
    // update the new-key-record using 'set' which works for existing doc
    newKey.set(data);

    return res.send({
      // return empty success response, so client can finish AJAX success
    });

  } catch(error) {
    console.log("Error $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", error);
    res.end();

  }
});


// ANCHOR - Firestore To Sheets [Nested email template data]
exports.firestoreToSheet = functions.firestore.document('formSubmission/{formId}')
  .onCreate(async (snapshot, context) => {
  
  let dataRow = {}; // sorted data to be converted to array for submit to sheet
  let dataRowForSheet; // data row as array to submit to sheet
  let emailTemplateName;
  let emailTemplateData;
  let appKeySubmitted; // use in submit data
  let spreadsheetId;
  let sheetId;
  let sheetHeader;

  try {
    /**
    * Prepare Data Row 
    */

    // Destructure Snapshot.data() which contains this form submission data
    let { appKey, createdDateTime, template: { data: { ...rest }, 
      name: templateName  }, webformId } = snapshot.data(); 
    // For building sort-ordered object that is turned into sheet data-row
    emailTemplateName = templateName;
    emailTemplateData = rest;
    // appkey to query 'spreadsheet' object info
    appKeySubmitted = appKey;
    // date/time: timezone string defined by momentjs.com/timezone: https://github.com/moment/moment-timezone/blob/develop/data/packed/latest.json
    const dateTime = createdDateTime.toDate(); // toDate() is firebase method
    // Add date-time to start of data object, format date with moment.js
    dataRow.createdDate = moment(dateTime).tz(rest.appInfoTimeZone).format('L');
    dataRow.createdTime = moment(dateTime).tz(rest.appInfoTimeZone).format('h:mm A z');
    // Add webformId to data object
    dataRow.webformId = webformId;

    // Template arrays for sort-ordered data-row and header fields
    let emailTemplateDoc = await db.collection('emailTemplate').doc(emailTemplateName).get();
    // data-row fields: sort ordered with empty string values
    emailTemplateDoc.data().templateData.map(field => dataRow[field] = ""); // add prop name + empty string value
    // header fields for sheet
    sheetHeader = [( emailTemplateDoc.data().sheetHeader )]; // sheets requires array within an array

    // Update sort-ordered props with data values
    Object.assign(dataRow, emailTemplateData);
    // Object to array because sheets data must be as array
    dataRow = Object.values(dataRow);
    // Sheets Row Data to add as array nested in array: [[ date, time, ... ]]
    dataRowForSheet = [( dataRow )];

    /**
    * Prepare to insert data-row in app-specific spreadsheet
    */

    // Get app spreadsheetId and sheetId based on formSubmission emailTemplate
    let appDoc = await db.collection('app').doc(appKeySubmitted).get();
    spreadsheetId = appDoc.data().spreadsheet.id;
    sheetId = appDoc.data().spreadsheet.sheetId[emailTemplateName];

    // Authorize with google sheets
    await jwtClient.authorize();

    // Row: Add to sheet (header or data)
    const rangeHeader =  `${emailTemplateName}!A1`; // e.g. "contactDefault!A2"
    const rangeData =  `${emailTemplateName}!A2`; // e.g. "contactDefault!A2"

    const addRow = range => values => ({
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      ...range && { range }, // e.g. "contactDefault!A2"
      valueInputOption: "RAW",
      requestBody: {
        ...values && { values }
      }
    });
    
    // Row: Blank insert (sheetId argument: existing vs new sheet)
    const blankRowInsertAfterHeader = sheetId => ({
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      resource: {
        requests: [
          {
            "insertDimension": {
              "range": {
                "sheetId": sheetId,
                "dimension": "ROWS",
                "startIndex": 1,
                "endIndex": 2
              },
              "inheritFromBefore": false
            }
          }
        ]
      }
    });

    /**
    * Insert row data into sheet that matches template name
    */

    // Check if sheet name exists for data insert
    const sheetObjectRequest = {
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      includeGridData: false
    };
    var sheetDetails = await sheets.spreadsheets.get(sheetObjectRequest);
    let sheetNameExists = sheetDetails.data.sheets.find(sheet => {
      // if sheet name exists returns sheet 'properties' object, else is undefined
      return sheet.properties.title === emailTemplateName;
    });

    // If sheet name exists, insert data
    // Else, create new sheet + insert header + insert data
    if (sheetNameExists) {
      // Update Google Sheets Data
      await sheets.spreadsheets.batchUpdate(blankRowInsertAfterHeader(sheetId));
      await sheets.spreadsheets.values.update(addRow(rangeData)(dataRowForSheet));

    } else {

      // Add sheet
      const addSheet = {
        auth: jwtClient,
        spreadsheetId: spreadsheetId,
        resource: {
          requests: [
            {
              "addSheet": {
                "properties": {
                  "title": emailTemplateName,
                  "index": 0,
                  "gridProperties": {
                    "rowCount": 1000,
                    "columnCount": 26
                  },
                }
              } 
            }
          ]
        }
      };

      // Add sheet and return new sheet properties
      let newSheet = await sheets.spreadsheets.batchUpdate(addSheet);

      // Get new sheetId and add to app spreadsheet info
      // newSheet returns 'data' object with properties:
      // prop: spreadsheetId
      // prop: replies[0].addSheet.properties (sheetId, title, index, sheetType, gridProperties { rowCount, columnCount }
      // Map replies array array to get sheetId
      let newSheetProps = {};
      newSheet.data.replies.map(reply => newSheetProps.addSheet = reply.addSheet); 
      let newSheetId = newSheetProps.addSheet.properties.sheetId;

      // Add new sheetId to app spreadsheet info
      db.collection('app').doc(appKeySubmitted).update({
          ['spreadsheet.sheetId.' + emailTemplateName]: newSheetId
      });

      // New Sheet Actions: add rows for header, then data
      await sheets.spreadsheets.values.update(addRow(rangeHeader)(sheetHeader));
      await sheets.spreadsheets.values.update(addRow(rangeData)(dataRowForSheet));

    } // end 'else' add new sheet

  }
  catch(error) {
    console.log("Error $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", error);
    res.end();

  }

});


// ANCHOR Firebase to Sheets [Basic 2 Column List]
exports.firebaseToSheet = functions.database.ref("/Form")
  .onUpdate(async change => {

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

