/*------------------------------------------------------------------------------
  Form Data and Sheet Header Rows
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const moment = require('moment-timezone'); // Timestamp formats and timezones
const { logErrorInfo, sortObjectsAsc, objectValuesByKey } =
  require("../utility");

/*------------------------------------------------------------------------------
  Form Data and Sheet Header Rows:
  ...
------------------------------------------------------------------------------*/
const formDataAndSheetHeaderRows = async (db, snapshot) => {

  // Form Results
  const { appKey, createdDateTime, template: { data: { ...templateData },
    name: templateName  } } = snapshot.data();

  try {

    ////////////////////////////////////////////////////////////////////////////
    // Prepare data row values and sheet header
    ////////////////////////////////////////////////////////////////////////////

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
    const sheetHeaderRowSorted = [
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
    const formDataRowSorted = [(
      Object.values({
        createdDate,
        createdTime,
        ...templateDataSorted
      })
    )];
    //
    // [END] Row Data: Sort and Merge
    ////////////////////////////////////////////////////////////////////////////

    return ({
      sheetHeaderRowSorted,
      formDataRowSorted
    })


  } catch(error) {

    console.error(logErrorInfo(error));

  }

}

module.exports = formDataAndSheetHeaderRows;