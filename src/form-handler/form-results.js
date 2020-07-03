/*------------------------------------------------------------------------------
  Form Results Data
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const { objectValuesByKey } = require("./../utility");

/*-- Cloud Function ----------------------------------------------------------*/
const spamCheck = require('./spam-check');

const formResults = async (req, admin, db, formSubmission, app, globalApp,
  envKeys) => {

  //////////////////////////////////////////////////////////////////////////////
  // Props All
  // Compile form-submission and databasae fields into single object
  //////////////////////////////////////////////////////////////////////////////
  const getPropsAll = async () => {
    // Form Field Defaults: select all default fields from database
    const formFieldsDefaultRef = await db.collection('formField')
      .where('default', '==', true).get();

    // Return object containing default fields
    const formFieldsDefault = formFieldsDefaultRef.docs.reduce((a, doc) => {
      a[doc.id] = doc.data().value;
      return a;
    }, {});

    // Consolidate fields as props, last-in overwrite previous
    return {
      appKey: app.id, ...formFieldsDefault, ...formSubmission, ...app.appInfo
    }
  };
  const propsAll = await getPropsAll();

  //////////////////////////////////////////////////////////////////////////////
  // Form Template: Data and Fields Whitelist IDs
  // Whitelist of Fields IDs used to identify props to add to database at
  // submitForm/.../template.data used by 'trigger email' extensiona
  //////////////////////////////////////////////////////////////////////////////
  const getFormTemplate = async () => {
    const formTemplateRef = await db.collection('formTemplate')
      .doc(propsAll.templateName).get();

    const data = formTemplateRef.data();

    const fieldsIdWhitelist = objectValuesByKey(data.fields, 'id');

    return { data, fieldsIdWhitelist }
  }
  const formTemplate = await getFormTemplate();

  //////////////////////////////////////////////////////////////////////////////
  // Props Allowed
  // Excludes fields not used for database or code actions to prevent database
  // errors due to querying docs using disallowed values
  // e.g. if html <input> had name="__anything__"
  // See doc limits: https://firebase.google.com/docs/firestore/quotas#limits
  //////////////////////////////////////////////////////////////////////////////
  const getPropsAllowed = async () => {
    // Form Fields Required: fields required for cloud function to work
    // Return Array of field names
    const formFieldsRequiredRef = await db.collection('formField')
      .where('required', '==', true).get();

    const formFieldsRequired = formFieldsRequiredRef.docs.reduce((a, doc) => {
      a.push(doc.id);
      return a;
    }, []);

    // Props Keys Whitelist:
    // Array for database & code actions last-in overwrites previous
    const propsKeysWhitelist = [
      ...formFieldsRequired,
      ...formTemplate.fieldsIdWhitelist,
      ...Object.keys(app.appInfo)
    ];

    // Props Allowed Entries:
    // Return Object entries used for database or code actions
    const allowedEntries = Object.entries(propsAll).reduce(
      (a, [key, value]) => {
        if (propsKeysWhitelist.includes(key)) {
          a[key] = value;
        }
        return a;
      }, {});

    return allowedEntries;
  }
  const propsAllowed = await getPropsAllowed();

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
        if (formTemplate.fieldsIdWhitelist.includes(key)) {
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
  // Set props allowed
  //////////////////////////////////////////////////////////////////////////////
  props.set(propsAllowed);

  //////////////////////////////////////////////////////////////////////////////
  // Set props spam check result
  //////////////////////////////////////////////////////////////////////////////
  props.set(
    await spamCheck(
      envKeys, req, app, globalApp, formTemplate.data, props.get().data
    )
  );

  //////////////////////////////////////////////////////////////////////////////
  // Return all props
  //////////////////////////////////////////////////////////////////////////////
  return props.get();

}

module.exports = formResults;