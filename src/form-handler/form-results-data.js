/*------------------------------------------------------------------------------
  Form Fields Data

------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const { AkismetClient } = require('akismet-api/lib/akismet.js'); // had to hardcode path
const path = require('path');
const { sortObjectsAsc, objectValuesByKey } =
  require(path.join(__dirname, "../utility"));

const formResultsData = async (req, admin, db, formSubmission, app, globalApp) => {

    ////////////////////////////////////////////////////////////////////////////
    // Props/Fields
    // Compile database and form fields to be handled as object entries, and
    // add to structured object
    ////////////////////////////////////////////////////////////////////////////
    const appKey = app.id;
    const appInfo = app.appInfo;

    //
    // Form Field Defaults: select from db all default fields
    // Return Object of docs
    //
    const formFieldsDefaultRef = await db.collection('formField')
      .where('default', '==', true).get();

    const formFieldsDefault = formFieldsDefaultRef.docs.reduce((a, doc) => {
      a[doc.id] = doc.data().value;
      return a;
    }, {});

    //
    // Props All: consolidate props and fields last-in overwrites previous
    //
    const propsAll = { appKey, ...formFieldsDefault, ...formSubmission, ...appInfo };

    ////////////////////////////////////////////////////////////////////////////
    // Props Allowed Entries: reduce to allowed props
    //
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

    //
    // Form Fields Required: fields required for cloud function to work
    // Return Array of field names
    //
    const formFieldsRequiredRef = await db.collection('formField')
      .where('required', '==', true).get();

    const formFieldsRequired = formFieldsRequiredRef.docs.reduce((a, doc) => {
      a.push(doc.id);
      return a;
    }, []);

    //
    // Form Template Fields:
    // Array of field for submitForm/.../template.data used by 'trigger email' extension
    //
    const formTemplateRef = await db.collection('formTemplate')
      .doc(propsAll.templateName).get();

    const formTemplateFieldsSorted = objectValuesByKey(
      sortObjectsAsc(formTemplateRef.data().fields, 'position'), 'id');

    // Props Whitelist:
    // Array of prop keys allowed for database or code actions last-in overwrites previous
    const propsWhitelist = [ ...formFieldsRequired, ...formTemplateFieldsSorted,
      ...Object.keys(appInfo)
    ];

    //
    // Props Allowed Entries: entries used for database or code actions
    // Return Object
    //
    const propsAllowedEntries = Object.entries(propsAll).reduce((a, [key, value]) => {
      if (propsWhitelist.includes(key)) {
        a[key] = value;
      }
      return a;
    }, {});
    //
    // [END] Props Allowed Entries: reduce to allowed props
    ////////////////////////////////////////////////////////////////////////////

    ////////////////////////////////////////////////////////////////////////////
    // Props Set & Get
    //
    const props = (() => {

      const trim = value => value.toString().trim();
      const props =  { toUids: '', templateData: {} }

      // compare database fields with form-submitted props and build object
      const setProps = propsToParse =>
        Object.entries(propsToParse).forEach(([prop, data]) => {
          data = trim(data);
          props[prop] = data;
          // toUids: appKey value unless if spam flagged is [ akismet spam message ]
          if (prop === 'appKey') {
            props.toUids = data;
          } else if (prop === 'toUidsSpamOverride') {
            props.toUids = data;
          }
          // Form Template Fields: Whitelist check [START]
          if (formTemplateFieldsSorted.includes(prop)) {
            props.templateData[prop] = data;
          }
          // Form Template Fields: Whitelist check [END]
        });

      const getProps = ({ templateData, urlRedirect = false, ...key } = props) => ({
        data: {
          appKey: key.appKey,
          createdDateTime: admin.firestore.FieldValue.serverTimestamp(),
          from: key.appFrom,
          ...key.spam && { spam: key.spam }, // only defined if akismet enabled
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
    // Set allowed props
    props.set(propsAllowedEntries);
    //
    // [END] Props Set & Get
    ////////////////////////////////////////////////////////////////////////////


    ////////////////////////////////////////////////////////////////////////////
    // Akismet Spam Filter
    // If enabled:
    //  1) Checks if spam
    //     a. minimally checks IP Address and User Agent
    //     b. checks fields defined as 'content' and 'other' based on config
    //  2) Sets props
    //     a. spam
    //     b. toUidsSpamOverride (if spam, string overrides UID to prevent email)
    //
    let akismetEnabled = false;
    if (globalApp.condition.spamFilterAkismet === 1
        || (globalApp.condition.spamFilterAkismet === 2
            && !!app.condition.spamFilterAkismet)
    ) {
      akismetEnabled = true;
    }

    if (akismetEnabled) {
      // Akismet credentials
      const key = app.spamFilterAkismet.key;
      const blog = app.appInfo.appUrl;
      const client = new AkismetClient({ key, blog })

      try {
        // Returns akismet props either as string or {}
        // ternary with reduce
        const akismetProps = fieldGroup => accumulatorType =>
          // if database contains fieldsAkismet and [fieldGroup] array
          ( typeof formTemplateRef.data().fieldsAkismet !== 'undefined'
            && typeof formTemplateRef.data().fieldsAkismet[fieldGroup] !== 'undefined'
            && formTemplateRef.data().fieldsAkismet[fieldGroup].length > 0)
          // if true then reduce
          ? (formTemplateRef.data().fieldsAkismet[fieldGroup].reduce((a, field) => {
            // skip if field not found in props.get()...
            if (typeof props.get().data.template.data[field] === 'undefined') {
              return a
            }
            // accumulate as 'string' or {} based on accumulatorType
            if (typeof accumulatorType === 'string') {
              return a + props.get().data.template.data[field] + " ";
            } else if (accumulatorType.constructor === Object) {
              a[field] = props.get().data.template.data[field];
              return a;
            }
          }, accumulatorType))
          // if false then null
          : null;

          // Data to check for spam
        const dataToCheck = {
          ...req.ip && { ip: req.ip },
          ...req.headers['user-agent'] && { useragent: req.headers['user-agent'] },
          ...akismetProps('content')('') && { content: akismetProps('content')('') },
          ...akismetProps('other')({})
        }

        // Test if data is spam: a successful test returns boolean
        const isSpam = await client.checkSpam(dataToCheck);
        // if spam suspected
        if (typeof isSpam === 'boolean' && isSpam) {
          props.set({spam: 'true' });
          props.set({toUidsSpamOverride: "SPAM_SUSPECTED_DO_NOT_EMAIL" });
        }
        // if spam not suspected
        else if (typeof isSpam === 'boolean' && !isSpam) {
          props.set({spam: 'false' });
        }

      } catch(err) {

        // Validate API Key
        const isValid = await client.verifyKey();
        if (isValid) {
          console.info('Akismet: API key is valid');
        } else if (!isValid) {
          console.warn('Akismet: Invalid API key');
        }

        // if api key valid: error is likely network failure of client.checkSpam()
        console.error("Akismet ", err);

      }

    }
    //
    // [END] Akismet Spam Filter
    ////////////////////////////////////////////////////////////////////////////

    return props.get().data

}

module.exports = formResultsData;