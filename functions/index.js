// SECTION Requirements

// Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');
// Firebase Admin SDK to access the Firebase/Firestore Realtime Database.
const admin = require('firebase-admin');
// [**** CREDENTIALS START ****]
const serviceAccount = require('./service-account.json'); // download from firebase console
admin.initializeApp({ // initialize firebase admin with credentials
  credential: admin.credential.cert(serviceAccount), // So functions can connect to database
  databaseURL: 'https://loveyou-forms.firebaseio.com' // Needed if using FireBase database (not FireStore)
});
// [**** CREDENTIALS STOP ****]
const db = admin.firestore(); // FireStore database reference
// Timestamps: required for adding server-timestamps to any database docs
const FieldValue = require('firebase-admin').firestore.FieldValue; // Timestamp here
const timestampSettings = { timestampsInSnapshots: true}; // Define timestamp settings
db.settings(timestampSettings); // Apply timestamp settings to database settings
const moment = require('moment-timezone'); // Timestamp formats and timezones
// Google APIs
const { google } = require('googleapis');
const sheets = google.sheets('v4'); // Google Sheets
const jwtClient = new google.auth.JWT({ // JWT Authentication (for google sheets)
  email: serviceAccount.client_email, // [**** CREDENTIALS ****]
  key: serviceAccount.private_key, // [**** CREDENTIALS ****]
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] // read and write sheets
});

// !SECTION

// SECTION Helper Functions

let toObject = string => val => ({ [string]: val });

const logErrorInfo = error => ({
  Error: 'Description and source line:',
  description: error,
  break: '**************************************************************',
  Logger: ('Error reported by log enty at:'),
  info: (new Error()),
});

const responseErrorBasic = string => ({
  message: {
    error: string
  }
});

// !SECTION

// Terminate HTTP functions with res.redirect(), res.send(), or res.end().
// https://firebase.google.com/docs/functions/terminate-functions

// ANCHOR Form Handler
exports.formHandler = functions.https.onRequest(async (req, res) => {

  try {

    const props = (() => {

      let props = { appKey: '', appFrom: '', appUrl: '', email: '', 
        webformId: '', templateName: '', templateData: {}, urlRedirect: '' }
      
      let getProps = ({ appKey, appFrom, appUrl, email, webformId, 
        templateName, templateData, urlRedirect  } = props) => ({
        data: {
          appKey, 
          createdDateTime: FieldValue.serverTimestamp(), 
          from: appFrom, 
          toUids: [ appKey ], 
          replyTo: email,
          webformId, 
          template: { 
            name: templateName, 
            data: templateData
          }
        },
        appUrl,
        urlRedirect
      });
   
      let templateDataWhitelist = [];

      let sanitizeValue = (value, maxLength) => 
        value.toString().trim().substr(0, maxLength);
    
      let setProp = (propKey, value, maxLength) => {
        let valueSanitized = sanitizeValue(value, maxLength);
        props[propKey] = valueSanitized; // add each prop to props, then also...
        if (templateDataWhitelist.includes(propKey)) {
          props.templateData[propKey] = valueSanitized;
        } 
      }

      let setTemplateDataWhitelist = array => {
        templateDataWhitelist = array;
      }

      return {
        setTemplateDataWhitelist: (array) => {
          setTemplateDataWhitelist(array)
        },
        getTemplateDataWhitelist: () => templateDataWhitelist, // fyi only - not used
        set: (propKey, value, maxLength) => {
          return setProp(propKey, value, maxLength);
        },
        get: () => getProps(),
      }
    })();


    /**
     * Global config
     */
    const globals = await db.collection('global').get();
    const globalConfig = globals.docs.reduce((object, doc) => { 
      object[doc.id] = doc.data();
      return object;
    }, {});


    /**
     *  Check if form submitted by authorized app or stop processing cloud function
     */
   
    const app = await db.collection('app').doc(req.body.appKey).get();
    // App key validation: if exists continue with cors validation
    if (app) {
      // FIXME SET: appKey, appUrl
      props.set('appKey', app.id);
      props.set('appUrl', app.data().appInfo.appUrl); // must set before cors check
      // CORS validation: stop cloud function if CORS check does not pass
      if (globalConfig.cors.bypass) {
        // allow * so localhost (or any source) recieves response
        res.set('Access-Control-Allow-Origin', '*');
      } else {
        // restrict to url requests that match the app
        // FIXME GET: appUrl !!! FIXED !!!
        res.set('Access-Control-Allow-Origin', app.data().appInfo.appUrl);
        // end processing if url does not match (req.headers.origin = url)
        if (req.headers.origin !== app.data().appInfo.appUrl) { 
          console.info(new Error('Origin Url does not match app url.'));
          return res.end();
        } 
      }
    } else {
      console.info(new Error('App Key does not exist.'));
      res.end();
    }


    /**
     *  Continue with form processing since passed valid app checks
     */
  
    // Url redirect: use global redirect by default unless overridden by form elements
    // FIXME SET: urlRedirect
    props.set('urlRedirect', globalConfig.urlRedirect.default);

    // Template name: global config unless form override
    let templateName = globalConfig.defaultTemplate.name;
    if (req.body.templateName) { templateName = req.body.templateName }
    // FIXME SET: templateName
    props.set('templateName', templateName);

    // Template data whitelist: template props allowed to be added to email template
    let templateDataWhitelist = await db.collection('emailTemplate').doc(templateName).get();
    templateDataWhitelist = templateDataWhitelist.data().templateData;
    props.setTemplateDataWhitelist(templateDataWhitelist); 

    // App Info: set after template data whitelist or props will be excluded from template data
    let appInfoObject = app.data().appInfo;
    // FIXME SET: appInfo props
    for (const prop in appInfoObject) {
      props.set(prop, appInfoObject[prop]);
    }

    // Form Elements: Add submitted to props with maxLength values
    let { ...formElements } = req.body; 
    // Collection formField contains maxLength values
    let formFields = await db.collection('formField').get();
    // FIXME SET: formElements
    for (const doc of formFields.docs) {
      let maxLength = doc.data().maxLength;
      if (formElements.hasOwnProperty(doc.id)) {
        props.set(doc.id, formElements[doc.id], maxLength);
      }
    }

    

    /** [Start] Row Data: Sort & Merge ****************************************/
    const vals = (() => {

      let props = { templateData: {} };
    
      let get = ({ ...key } = props) => ({
        data: {
          appKey: key.appKey, 
          createdDateTime: FieldValue.serverTimestamp(), 
          from: key.appFrom, 
          toUids: [ key.appKey ], 
//          replyTo: key.templateData.email,
//          webformId: key.templateData.webformId, 
          template: { 
            name: key.templateName, 
            data: key.templateData
          }
        },
        urlRedirect: key.urlRedirect
      });
    
      let sanitize = (value, maxLength) => 
        value.toString().trim().substr(0, maxLength);
    
      return {
        set: (propKey, value, maxLength) => {
          console.log("setProps: $$$$$$$$$$$$$$$$$$$$$$$ ", propKey, value, maxLength);
          return props[propKey] = sanitize(value, maxLength);
        },
        get: () => get(),
      }
    })();
    
    let toObject2 = (string, val) => ({ [string]: val });
    let arrayOfObjects = object => Object.keys(object).map(function(key) {
      return {[key]: object[key]};
    });

    vals.set('appKey', app.id);
    for (const prop in appInfoObject) {
      vals.set(prop, appInfoObject[prop]);
    }
    vals.set('urlRedirect', globalConfig.urlRedirect.default);
    vals.set('templateName', templateName);
    console.log("vals.get() ", vals.get());

    let oAppInfo = arrayOfObjects(appInfoObject);
    let oAppKey = toObject2('appKey', app.id);
    let oUrlRedirect = toObject2('urlRedirect', globalConfig.urlRedirect.default);
    let oTemplateName = toObject2('templateName', templateName);
    let oFormElements = arrayOfObjects(formElements);

    console.log("formFields typeof $$$$$$$$$$$$$$$$$$$$$$$$ ", typeof formFields.docs);
    console.log("formFields.docs $$$$$$$$$$$$$$$$$$$$$$$$ ", formFields.docs);

    let formFieldObject = formFields.docs.reduce((a, doc) => {
      a[doc.id] = doc.data();
      // templateData[c] ? a[c] = templateData[c] : a[c] = "";
      return a
    }, {});
//    console.log("formFieldObject $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", formFieldObject);

    /*
    formFields.docs.forEach(doc => {
      let maxLength = doc.data().maxLength;
      if (formElements.hasOwnProperty(doc.id)) {
        vals.set(doc.id, formElements[doc.id], maxLength);
      }
    });
    */
    //let tempDocs = formFields.docs.forEach(doc => {
      //let max = doc.maxLength;
      //formElements[doc.id] ? 
    //});
    //console.log("tempDocs: $$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", tempDocs);
    let myFormElements = formElements;
    console.log("myFormElements $$$$$$$$$$$$$$$$$$$$$$$$$$$$ ", myFormElements);

    let valsObjects = [ oAppKey, ...oAppInfo, oUrlRedirect, oTemplateName, ...oFormElements ];
    console.log("valsObjects: ", valsObjects);
    console.log("vals.get() ", vals.get());

    for (const doc of formFields.docs) {
      let maxLength = doc.data().maxLength;
      if (valsObjects.hasOwnProperty(doc.id)) {
        vals.set(doc.id, valsObject[doc.id], maxLength);
      }
      if (templateDataWhitelist.includes(doc.id) && valsObjects[doc.id]) {
        vals.set('templateData.' + [doc.id], valsObjects[doc.id], maxLength);
      } 
    }
    console.log("vals.get() ", vals.get());

    /*
    props.set(prop, appInfoObject[prop]);
    props.set(doc.id, formElements[doc.id], maxLength);

    // Strings to 'prop: value' objects so data to be merged has uniform format
    // timezone 'tz' string defined by momentjs.com/timezone: https://github.com/moment/moment-timezone/blob/develop/data/packed/latest.json

    let dataWebformId = toObject('webformId')(webformId);
    // Reduce array emailTemplate.templateData, this returns an object that 
    // is sort-ordered to matach the sheetHeader fields.
    let templateDataSorted = emailTemplate.data().templateData.reduce((a, c) => {
      templateData[c] ? a[c] = templateData[c] : a[c] = "";
      return a
    }, {});
    // Values-only: merge objects in sort-order and return only values
    // Data-row for sheet requires nested array of strings [ [ 'John Smith', etc ] ]
    let sheetDataRow = [( Object.values({ ...createdDate, ...createdTime, 
      ...dataWebformId, ...templateDataSorted }) )];
*/
    /** [End] Row Data: Sort & Merge ******************************************/


    // For serverTimestamp to work must first create new doc key then 'set' data
    const newKey = db.collection("formSubmission").doc();
    // update the new-key-record using 'set' which works for existing doc
    // FIXME GET ALL: data
    newKey.set(props.get().data)

    /**
     * Response
     */

    return res.status(200).send({
      // return response (even if empty) so client can finish AJAX success
      data: {
        // FIXME GET: urlRedirect
        redirect: props.get().urlRedirect
      }
    });

  } catch(error) {

    console.error(logErrorInfo(error));

    return res.status(500).send(responseErrorBasic('Error: Application error.'));

  } // end catch

});


// ANCHOR - Firestore To Sheets [New sheet, header, and data row]
exports.firestoreToSheets = functions.firestore.document('formSubmission/{formId}')
  .onCreate(async (snapshot, context) => {

  try {

    /**
    * Prepare row data values and sheet header
    */

    // Form Submission: values from Snapshot.data()
    let { appKey, createdDateTime, template: { data: { ...templateData }, 
      name: templateName  }, webformId } = snapshot.data();

    // Template: two sort-ordered arrays of strings
    // sheetHeader array is sorted according to desired sheets visual
    // templateData array is sorted to match the order of sheetHeader
    let emailTemplate = await db.collection('emailTemplate').doc(templateName).get();

    // Header fields for sheet requires nested array of strings [ [ 'Date', 'Time', etc ] ]
    let sheetHeader = [( emailTemplate.data().sheetHeader )]; 

    /** [Start] Row Data: Sort & Merge ****************************************/
    // Strings to 'prop: value' objects so data to be merged has uniform format
    // timezone 'tz' string defined by momentjs.com/timezone: https://github.com/moment/moment-timezone/blob/develop/data/packed/latest.json
    const dateTime = createdDateTime.toDate(); // toDate() is firebase method
    let createdDate = toObject('createdDate')(moment(dateTime).tz(templateData.appTimeZone).format('L'));
    let createdTime = toObject('createdTime')(moment(dateTime).tz(templateData.appTimeZone).format('h:mm A z'));
    let dataWebformId = toObject('webformId')(webformId);
    // Reduce array emailTemplate.templateData, this returns an object that 
    // is sort-ordered to matach the sheetHeader fields.
    let templateDataSorted = emailTemplate.data().templateData.reduce((a, c) => {
      templateData[c] ? a[c] = templateData[c] : a[c] = "";
      return a
    }, {});
    // Merge objects in sort-order and return only values
    // Data-row for sheet requires nested array of strings [ [ 'John Smith', etc ] ]
    let sheetDataRow = [( Object.values({ ...createdDate, ...createdTime, 
      ...dataWebformId, ...templateDataSorted }) )];
    /** [End] Row Data: Sort & Merge ******************************************/


    /**
    * Prepare to insert data-row into app spreadsheet
    */

    // Get app spreadsheetId and sheetId (one spreadsheet with multiple sheets possible)
    let app = await db.collection('app').doc(appKey).get();
    let spreadsheetId = app.data().spreadsheet.id; // one spreadsheet per app
    let sheetId = app.data().spreadsheet.sheetId[templateName]; // multiple possible sheets

    // Authorize with google sheets
    await jwtClient.authorize();

    // Row: Add to sheet (header or data)
    const rangeHeader =  `${templateName}!A1`; // e.g. "contactDefault!A1"
    const rangeData =  `${templateName}!A2`; // e.g. "contactDefault!A2"

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
    const sheetObjectRequest = () => ({
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      includeGridData: false
    });
    let sheetDetails = await sheets.spreadsheets.get(sheetObjectRequest());
    let sheetNameExists = sheetDetails.data.sheets.find(sheet => {
      // if sheet name exists returns sheet 'properties' object, else is undefined
      return sheet.properties.title === templateName;
    });

    // If sheet name exists, insert data
    // Else, create new sheet + insert header + insert data
    if (sheetNameExists) {
      // Insert into spreadsheet a blank row and the new data row
      await sheets.spreadsheets.batchUpdate(blankRowInsertAfterHeader(sheetId));
      await sheets.spreadsheets.values.update(addRow(rangeData)(sheetDataRow));

    } else {
      // Create new sheet, insert heder and new row data
      
      // Request object for adding sheet to existing spreadsheet
      const addSheet = () => ({
        auth: jwtClient,
        spreadsheetId: spreadsheetId,
        resource: {
          requests: [
            {
              "addSheet": {
                "properties": {
                  "title": templateName,
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
      });

      // Add new sheet:
      // 'addSheet' request object returns new sheet properties
      // Get new sheetId and add to app spreadsheet info
      // newSheet returns 'data' object with properties:
      //   prop: spreadsheetId
      //   prop: replies[0].addSheet.properties (sheetId, title, index, sheetType, gridProperties { rowCount, columnCount }
      let newSheet = await sheets.spreadsheets.batchUpdate(addSheet());
      // Map 'replies' array to get sheetId
      let newSheetId = sheet => {
        let newSheet = {};
        sheet.data.replies.map(reply => newSheet.addSheet = reply.addSheet);
        return newSheet.addSheet.properties.sheetId;
      };

      // Add new sheetId to app spreadsheet info
      db.collection('app').doc(appKey).update({
          ['spreadsheet.sheetId.' + templateName]: newSheetId(newSheet)
      });

      // New Sheet Actions: add row header then row data
      await sheets.spreadsheets.values.update(addRow(rangeHeader)(sheetHeader));
      await sheets.spreadsheets.values.update(addRow(rangeData)(sheetDataRow));

    } // end 'else' add new sheet

  } catch(error) {
    
    console.error(logErrorInfo(error));

  } // end catch

});


// ANCHOR Firebase to Sheets [Basic 2 Column List]
exports.firebaseToSheets = functions.database.ref("/Form")
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
  let itemArray = [];
  let valueArray = [];
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

