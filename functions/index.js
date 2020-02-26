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

  // Form submitted data
  let { app: appKey, template = 'contactDefault', webformId, ...rest } 
    = req.body; // template default 'contactForm' if not added in webform

  // Sanitize data
  let sanitizedData = {};
  function sanitize(string, charCount) { return string.trim().substr(0, charCount) };

  let formFields = await db.collection('formField').get();
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
  console.log("sanitizedData $$$$$$$$$$$$$$$$$$ ", sanitizedData);

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
        sanitizedData.appInfoName = appInfoName;
        sanitizedData.appInfoUrl = appInfoUrl;
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

});


// ANCHOR - Firestore To Sheets [Nested email template data]
exports.firestoreToSheet = functions.firestore.document('formSubmission/{formId}').onCreate(async () => {
  
  let rowData = {}; // will contain data row to be submitted to sheet
  let emailTemplateName;
  let emailTemplateData;
  let appKeySubmitted; // use in submit data
  let spreadsheetId; // use in both try and catch so declare here
  let sheetId;
  let sheetHeader;
  let rowDataInsert;

  try {
    /**
    * Prepare Data Row 
    */

    // Get last form submission 
    const formSubmission = await db.collection('formSubmission')
      .orderBy('createdDateTime', 'desc').limit(1).get();
      formSubmission.docs.map(doc => {
        // doc.data() is object -> { name: 'jax', email: 'jax@jax.com' }
        let { appKey, createdDateTime, template: { data: { ...rest }, name: templateName  }, webformId } = doc.data(); 
        // For building sort-ordered object that is turned into sheet data-row
        emailTemplateName = templateName;
        emailTemplateData = rest;
        // appkey to query 'spreadsheet' object info
        appKeySubmitted = appKey;
        // date and time
        // FIXME get timezone from 'app' config so will post to excel
        const created = createdDateTime.toDate(); // toDate() is firebase method
        const createdDate = moment(created).tz("America/New_York").format('L'); // Format date with moment.js
        const createdTime = moment(created).tz("America/New_York").format('h:mm A z');
        // Add date-time to start of data object
        rowData.createdDate = createdDate;
        rowData.createdTime = createdTime;
        // Add webformId to data object
        rowData.webformId = webformId;
        return;
      });

    // Email Template data
    await db.collection('emailTemplate').doc(emailTemplateName).get()
      .then(doc => {
        if (!doc.exists) {
          console.log('No such email template name!');
        } else {
          // Get emailTemplate templateData fields by sort-order, add empty to rowData{}
          doc.data().templateData.map(f => {
            return rowData[f] = ""; // add prop name + empty string value
          });
          // sheets requires array within an array
          sheetHeader = [( doc.data().sheetHeader )];
        }
      })
      .catch(err => {
        console.log('Error getting email template name!', err);
      });

    // Update rowData{} sort-ordered emailTemplate props with data values
    Object.assign(rowData, emailTemplateData);
    // Object to array because valueArray needs to contain another array
    rowData = Object.values(rowData);
    // Sheets Row Data to add ... valueArray: [[ date, time, ... ]]
    const valueArray = [( rowData )];

    /**
    * Submit Data Row to app-specific spreadsheet
    */

    // Get app spreadsheetId and formSubmission's emailTemplate sheetId
    await db.collection('app').doc(appKeySubmitted).get()
      .then(doc => {
        if (!doc.exists) {
          console.log('No such email template name!');
        } else {
          spreadsheetId = doc.data().spreadsheet.id;
          sheetId = doc.data().spreadsheet.sheetId[emailTemplateName];
        }
      })
      .catch(err => {
        console.log('Error getting email template name!', err);
      });

    // Authorize with google sheets
    await jwtClient.authorize();
 
    // Add row data request defined
    const addRowDataAfterHeader = {
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      range: `${emailTemplateName}!A2`, // e.g. "contactDefault!A2"
      valueInputOption: "RAW",
      requestBody: {
        values: valueArray
      }
    };

    // Check for Sheet name
    const exists = {
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      range: `${emailTemplateName}!A2`, // e.g. "contactDefault!A2"
    };
 
    // Insert blank row
    const insertBlankRowAfterHeader = sheetIdMe => ({
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      resource: {
        requests: [
          // following requires "..." otherwise function error
          {
            "insertDimension": {
              "range": {
                "sheetId": sheetIdMe,
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

    const sheetName = {
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      includeGridData: false
    };

    var sheet = await sheets.spreadsheets.get(sheetName);
    console.log("Sheet Data ??????????????????????????????? ", sheet.data);
    console.log("Sheet Data Sheets ??????????????????????????????? ", sheet.data.sheets);

    let sheetNameExists = sheet.data.sheets.find(e => {
      return e.properties.title === emailTemplateName;
    });
    console.log("sheetNames $$$$$$$$$$$$$$$$$$$$$$$$$$$ ", sheetNameExists);

//    let sheetExists = (await sheets.spreadsheets.values.get(exists)).data;
    //console.log("Sheet Exists $$$$$$$$$$$$$$$$$$$$$$$$$$$ ", sheetExists);

    if (sheetNameExists) {
      // Update Google Sheets Data
      await sheets.spreadsheets.batchUpdate(insertBlankRowAfterHeader(sheetId));
      await sheets.spreadsheets.values.update(addRowDataAfterHeader);
    } else {
      /**
       * Create new sheet if does not exist and add header row
       */
      
  //    if (errorMessage[0].includes("Unable to parse range:")) {

        // Add sheet
        const addSheet = {
          auth: jwtClient,
          spreadsheetId: spreadsheetId,
          resource: {
            requests: [
              // following requires "..." otherwise function error
              {
                "addSheet": {
                  "properties": {
                    "title": emailTemplateName,
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

        // Add header row
        const addHeaderRow = {
          auth: jwtClient,
          spreadsheetId: spreadsheetId,
          range: `${emailTemplateName}!A1`, // e.g. "contactDefault!A2"
          valueInputOption: "RAW",
          requestBody: {
            values: sheetHeader
          }
        };
        console.log("rowDataInsert 2 $$$$$$$$$$$$$$$$$$ ", rowDataInsert);
        // Add Header row
        await sheets.spreadsheets.values.update(addHeaderRow);
        // Add blank row new sheetId
        console.log("New Sheet Id 888888888888888888888888888888888 ", newSheetId);
        await sheets.spreadsheets.batchUpdate(insertBlankRowAfterHeader(newSheetId));
        // Add data row initially attempted prior to new sheet being added
        await sheets.spreadsheets.values.update(addRowDataAfterHeader);

    } // end 'else' add new sheet

  }
  catch(err) {
    // errors in 'errors' object, then map through errors array check for .message prop
    console.log("err $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", err);
    const errorMessage = err.errors.map(e => e.message);
    console.log("Error Message: ############# ", errorMessage);


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

