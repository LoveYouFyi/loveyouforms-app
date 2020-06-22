const admin = require('firebase-admin');
const functions = require("firebase-functions-test");
const { formHandler } = require('./index');

const testEnv = functions();


describe("formHandler", () => {
  // Mock setup
  const mockSet = jest.fn();
  mockSet.mockReturnValue(true); // mockReturnValue needs a parameter to work, so just sending 'true' 
  
  beforeEach(() => {
    jest.mock("firebase-admin", () => ({
      initializeApp: jest.fn(), // mock init app function from admin 
      database: () => ({
        ref: jest.fn(path => ({
          set: mockSet
        }))
      }),
      firestore: () => ({
        collection: (collectionName) => ({
          doc: (key) => ({
            get: () => ({
              data: jest.fn(() => ({
                appInfo: { appUrl: 'localhost:4000' },
                condition: { corsBypass: 1, messageGlobal: 1 },
                message: {}
              }))
            })
          })
        })
      })
    }));
  });

  afterEach(() => {
    jest.resetAllMocks();
  })
  // it("creates a form", () => {
  //   const wrapped = testEnv.wrap();
  //   // Create a test form
  //   const testForm = {}

  //   await wrapped(testForm);

  //   expect(admin.database().ref('').set).toBeCalledWith();
  // })
  it('handles form - undefined content type', async () => {
    const req = { headers: {} };
    const res = {
      end: jest.fn()
    }

    formHandler(req, res);
    expect(res.end).toBeCalled();
  });
  
  it('handles form - valid content type', async () => {
    const req = {
      body: JSON.stringify({ appKey: 'SOME_KEY' }),
      headers: { 'content-type': 'text/plain' }
    };
    const res = {
      end: jest.fn(),
      setHeader: jest.fn()
    }

    formHandler(req, res);
    //expect(res.setHeader).toBeCalledWith('Access-Control-Allow-Origin', '*');
  });
})
