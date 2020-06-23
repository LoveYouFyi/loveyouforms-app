/*------------------------------------------------------------------------------
  Doc-Schema Trigger Cloud Functions
  When a new 'doc' is created this adds default fields/schema to it
  Parameters: 'col' is collection type and 'schema' is from 'global' collection
------------------------------------------------------------------------------*/

module.exports = (col, schema, { admin }) => async (snapshot, context) => {

  const db = admin.firestore();

  try {

    // Get Default Schema
    const schemaRef = await db.collection('global').doc(schema).get();
    const schemaData = schemaRef.data();

    // Update new doc with default schema
    const appRef = db.collection(col).doc(context.params.id);
    appRef.set(schemaData); // update record with 'set' which is for existing doc

    return schemaData;

  } catch(error) {

    console.error(logErrorInfo(error));

  }

}

// Default schema functions for 'app' and 'formTemplate' collections
//module.exports.schemaApp = ({ admin }) = schemaDefault('app', 'schemaApp'),
//module.exports.schemaFormTemplate = schemaDefault('formTemplate', 'schemaFormTemplate')
