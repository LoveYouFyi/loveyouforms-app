/*------------------------------------------------------------------------------
  Firestore-to-Sheets Trigger Cloud Function
  Listens for new 'submitForm' collection docs and adds data to google sheets.
  If required, creates new sheet(tab) and row header.
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const moment = require('moment-timezone'); // Timestamp formats and timezones
const { logErrorInfo, sortObjectsAsc, objectValuesByKey } =
  require("./../utility");
// Sheets with Credentials
// service-account credentials: manually download file using Firebase console;
// credentials are used by cloud function to authenticate with Google Sheets API
const serviceAccount = require('./../../../../service-account.json');
const { google } = require('googleapis'); // Google API
const jwtClient = new google.auth.JWT({ // JWT Authentication (for google sheets)
  email: serviceAccount.client_email, // <--- CREDENTIALS
  key: serviceAccount.private_key, // <--- CREDENTIALS
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] // read and write sheets
});
const sheets = google.sheets('v4'); // Google Sheets

/*------------------------------------------------------------------------------
  Export Firestore To Sheets Function
------------------------------------------------------------------------------*/
module.exports = ({ admin }) => async (snapshot, context) => {

  const db = admin.firestore();

  try {

    ////////////////////////////////////////////////////////////////////////////
    // Prepare row data values and sheet header
    ////////////////////////////////////////////////////////////////////////////

    // Form Rusults: values from Snapshot.data()
    const { appKey, createdDateTime, template: { data: { ...templateData },
      name: templateName  } } = snapshot.data();

    // App Data
    const appRef = await db.collection('app').doc(appKey).get();
    const app = appRef.data();

    // Form Template for Template Field Ids and Header Row Sheet Columns
    // Database needs to have Fields Ids and Header Columns sorted to match
    // templateData array is sorted to match the order of headerRowSheet
    const formTemplateRef = await db.collection('formTemplate').doc(templateName).get();
    const formTemplate = formTemplateRef.data();

    // Fields Ids Sorted: required for sorting templateData so data row that is sent
    // to sheets will be sorted in the same order as the sheet's column header
    const formTemplateFieldsIdsSorted = objectValuesByKey(
      sortObjectsAsc(formTemplate.fields, "position"), "id");

    // Fields Sheet Headers Sorted: required for spreadsheet column headers when
    // adding a new sheet to a spreadsheet
    // Sheets requires a nested array of strings [ [ 'Date', 'Time', etc ] ]
    const formTemplateFieldsSheetHeadersSorted = [
      [
        'Date', 'Time',
        ...objectValuesByKey(
          sortObjectsAsc(formTemplate.fields, "position"), "sheetHeader")
      ]
    ];

    ////////////////////////////////////////////////////////////////////////////
    // Row Data: Sort and Merge (data row to be sent to sheets)
    //

    // timezone 'tz' string defined by momentjs.com/timezone:
    // https://github.com/moment/moment-timezone/blob/develop/data/packed/latest.json
    const dateTime = createdDateTime.toDate(); // toDate() is firebase method
    const createdDate = moment(dateTime).tz(app.appInfo.appTimeZone).format('L');
    const createdTime = moment(dateTime).tz(app.appInfo.appTimeZone).format('h:mm A z');

    // Template Data Sorted: returns an object that contains the new
    // formSubmit record's data sort-ordered to match formTemplate fields positions
    const templateDataSorted = formTemplateFieldsIdsSorted.reduce((a, fieldName) => {
      // if fieldName data not exist set empty string since config sort order requires it
      templateData[fieldName] ? a[fieldName] = templateData[fieldName] : a[fieldName] = "";
      return a
    }, {});

    // Merge objects in sort-order and return only values
    // Data-row for sheet requires nested array of strings [ [ 'John Smith', etc ] ]
    const sheetDataRow = [(
      Object.values({
        createdDate,
        createdTime,
        ...templateDataSorted
      })
    )];
    //
    // [END] Row Data: Sort and Merge
    ////////////////////////////////////////////////////////////////////////////


    ////////////////////////////////////////////////////////////////////////////
    // Prepare to insert data-row into app spreadsheet
    ////////////////////////////////////////////////////////////////////////////

    // Get app spreadsheetId and sheetId(s)
    const spreadsheetId = app.service.googleSheets.spreadsheetId; // one spreadsheet per app
    const sheetId = app.service.googleSheets.sheetId[templateName]; // multiple possible sheets

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


    ////////////////////////////////////////////////////////////////////////////
    // Insert row data into sheet that matches template name
    ////////////////////////////////////////////////////////////////////////////

    // Check if sheet name exists for data insert
    const sheetObjectRequest = () => ({
      auth: jwtClient,
      spreadsheetId: spreadsheetId,
      includeGridData: false
    });
    const sheetDetails = await sheets.spreadsheets.get(sheetObjectRequest());
    const sheetNameExists = sheetDetails.data.sheets.find(sheet => {
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
      //   prop: replies[0].addSheet.properties (
      //     sheetId, title, index, sheetType, gridProperties { rowCount, columnCount } )
      const newSheet = await sheets.spreadsheets.batchUpdate(addSheet());
      // Map 'replies' array to get sheetId
      const newSheetId = sheet => {
        const newSheet = {};
        sheet.data.replies.map(reply => newSheet.addSheet = reply.addSheet);
        return newSheet.addSheet.properties.sheetId;
      };

      // Add new sheetId to app spreadsheet info
      db.collection('app').doc(appKey).update({
        ['spreadsheet.sheetId.' + templateName]: newSheetId(newSheet)
      });

      // New Sheet Actions: add row header then row data
      await sheets.spreadsheets.values.update(
        addRow(rangeHeader)(formTemplateFieldsSheetHeadersSorted)
      );
      await sheets.spreadsheets.values.update(addRow(rangeData)(sheetDataRow));

    } // end 'else' add new sheet

  } catch(error) {

    console.error(logErrorInfo(error));

  }

}
