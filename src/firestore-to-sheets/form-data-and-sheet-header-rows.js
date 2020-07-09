/*------------------------------------------------------------------------------
  Form Data and Sheet Header Rows
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const moment = require('moment-timezone'); // Timestamp formats and timezones
const { logErrorInfo, sortObjectsAsc, objectValuesByKey } =
  require("../utility");

/*------------------------------------------------------------------------------
  Form Template: For Template Field Ids and Header Row Sheet Columns.
  Database needs to have Fields Ids and Header Columns sorted to match
  templateData array is sorted to match the order of headerRowSheet
------------------------------------------------------------------------------*/
const getFormTemplate = async (db, templateName) => {
 const gotFormTemplate = await db.collection('formTemplate').doc(templateName).get();
  return gotFormTemplate.data();
}

/*------------------------------------------------------------------------------
  Form Data and Sheet Header Rows:
  ...
------------------------------------------------------------------------------*/
const formDataAndSheetHeaderRows = async (snapshot, db, app) => {

  // Form Results
  const { appKey, createdDateTime, template: { data: { ...templateData },
    name: templateName  } } = snapshot.data();

  const formTemplate = await getFormTemplate(db, templateName);

  //////////////////////////////////////////////////////////////////////////////
  // Form Data Row:
  // Sort and merge data row to be sent to sheets
  //////////////////////////////////////////////////////////////////////////////

  // Fields Ids Sorted: required for sorting templateData so data row that is sent
  // to sheets will be sorted in the same order as the sheet's column header
  const formTemplateFieldsIdsSorted = objectValuesByKey(
    sortObjectsAsc(formTemplate.fields, "position"), "id");

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
  //////////////////////////////////////////////////////////////////////////////


  //////////////////////////////////////////////////////////////////////////////
  // Sheet Header Row Sorted: required for spreadsheet column headers when
  // adding a new sheet to a spreadsheet
  // Sheets requires a nested array of strings [ [ 'Date', 'Time', etc ] ]
  //////////////////////////////////////////////////////////////////////////////
  const sheetHeaderRowSorted = [
    [
      'Date', 'Time',
      ...objectValuesByKey(
        sortObjectsAsc(formTemplate.fields, "position"), "sheetHeader")
    ]
  ];


  return ({
    sheetHeaderRowSorted,
    formDataRowSorted
  })

}

module.exports = formDataAndSheetHeaderRows;