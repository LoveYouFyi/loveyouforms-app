/*------------------------------------------------------------------------------
  Form Results Data
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const path = require('path');
const { sortObjectsAsc, objectValuesByKey } =
  require(path.join(__dirname, "../utility"));

/*-- Cloud Function ----------------------------------------------------------*/
const spamCheck = require('./spam-check');

const formResults = async (req, admin, db, formSubmission, app, globalApp) => {

  //////////////////////////////////////////////////////////////////////////////
  // Props All
  // Compile form-submission and databasae fields into single object
  //////////////////////////////////////////////////////////////////////////////

  // Consolidate props and fields last-in overwrite previous
  const propsAll = async () => {
    // Form Field Defaults: select all default fields from database
    const formFieldsDefaultRef = await db.collection('formField')
      .where('default', '==', true).get();
    // Return object containing default fields
    const formFieldsDefault = formFieldsDefaultRef.docs.reduce((a, doc) => {
      a[doc.id] = doc.data().value;
      return a;
    }, {});

    return {
      appKey: app.id, ...formFieldsDefault, ...formSubmission, ...app.appInfo
    }
  };

  //////////////////////////////////////////////////////////////////////////////
  // Props Allowed: reduce entries to allowed props
  //////////////////////////////////////////////////////////////////////////////

  // Remove the fields not used for database or code actions to:
  // 1) prevent database errors due to querying docs using disallowed values
  //    e.g. if html <input> had name="__anything__"
  //    doc limits: https://firebase.google.com/docs/firestore/quotas#limits
  // 2) only include fields used for database or code actions
  //
  // Props Whitelist: compiled from database
  // Database Schema
  //   formField/'all required' --> formFieldsRequired
  //   formTemplate/'templateName'/fields --> formTemplateFields
  //   app/'appKey'/appInfo.*props --> appInfo

  const propsAllowed = async () => {
    const allProps = await propsAll();

    // Form Fields Required: fields required for cloud function to work
    // Return Array of field names
    const formFieldsRequiredRef = await db.collection('formField')
      .where('required', '==', true).get();

    const formFieldsRequired = formFieldsRequiredRef.docs.reduce((a, doc) => {
      a.push(doc.id);
      return a;
    }, []);

    // Form Template Fields Sorted:
    // Array for submitForm/.../template.data used by 'trigger email' extension
    const formTemplateRef = await db.collection('formTemplate')
      .doc(allProps.templateName).get();

    const formTemplate = formTemplateRef.data();

    const formTemplateFieldsId = objectValuesByKey(formTemplate.fields, 'id');

    // Props Whitelist:
    // Keys-allowed array for database & code actions last-in overwrite previous
    const propsWhitelistKeys = [
      ...formFieldsRequired,
      ...formTemplateFieldsId,
      ...Object.keys(app.appInfo)
    ];

    // Props Allowed Entries:
    // Return Object entries used for database or code actions
    const allowedEntries = Object.entries(allProps).reduce(
      (a, [key, value]) => {
        if (propsWhitelistKeys.includes(key)) {
          a[key] = value;
        }
        return a;
      }, {});

    return { entries: allowedEntries, formTemplate, formTemplateFieldsId }
    }
  // Get Props Allowed
  const allowedProps = await propsAllowed();

  //////////////////////////////////////////////////////////////////////////////
  // Props Set & Get
  // Props set to object structured to match 'trigger email' extension needs
  //////////////////////////////////////////////////////////////////////////////
  const props = (() => {

    const trim = value => value.toString().trim();
    const props =  { toUids: '', templateData: {} }

    // compare database fields with form-submitted props and build object
    const setProps = propsToParse =>
      Object.entries(propsToParse).forEach(([key, value]) => {
        value = trim(value);
        props[key] = value;
        // toUids: appKey value unless if spam true to prevent sending email
        if (key === 'appKey') {
          props.toUids = value;
        } else if (key === 'spam') {
          // if spam then override toUids value so email is not sent
          (value === 'true') && (props.toUids = "SPAM_SUSPECTED_DO_NOT_EMAIL");
        }
        // Form Template Fields: Whitelist check
        if (allowedProps.formTemplateFieldsId.includes(key)) {
          props.templateData[key] = value;
        }
      });

    const getProps =
      ({ templateData, urlRedirect = false, ...key } = props) => ({
        data: {
          appKey: key.appKey,
          createdDateTime: admin.firestore.FieldValue.serverTimestamp(),
          from: key.appFrom,
          ...key.spam && { spam: key.spam },
          toUids: [ key.toUids ],
          replyTo: templateData.email,
          template: {
            name: key.templateName,
            data: templateData
          }
        },
        urlRedirect: urlRedirect
      });

    return {
      set: props => {
        setProps(props);
      },
      get: () => {
        return getProps();
      }
    };
  })();

  //////////////////////////////////////////////////////////////////////////////
  // Set allowed props
  //////////////////////////////////////////////////////////////////////////////
  props.set(allowedProps.entries);

  //////////////////////////////////////////////////////////////////////////////
  // Set spam check result to props
  //////////////////////////////////////////////////////////////////////////////
  props.set(
    await spamCheck(req, app, globalApp, allowedProps.formTemplate,
      props.get().data)
  );

  //////////////////////////////////////////////////////////////////////////////
  // Return all props
  //////////////////////////////////////////////////////////////////////////////
  return props.get();

}

module.exports = formResults;