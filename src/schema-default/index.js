/*------------------------------------------------------------------------------
  Schema-Default Trigger Cloud Functions
  When a new 'doc' is created this adds default fields/schema to it
  schemaDefault(collection_name, global_schema_document_name, context)
------------------------------------------------------------------------------*/

module.exports = (collection, schema, { admin }) => async (snapshot, context) => {

  const db = admin.firestore();

  try {

    // Get Default Schema
    const schemaRef = await db.collection('global').doc(schema).get();
    const schemaData = schemaRef.data();

    // Update new doc with default schema
    const appRef = db.collection(collection).doc(context.params.id);
    appRef.set(schemaData); // update record with 'set' which is for existing doc

    return schemaData;

  } catch(error) {

    console.error(logErrorInfo(error));

  }

}
