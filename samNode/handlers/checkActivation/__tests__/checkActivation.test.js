const MockDate = require('mockdate');
const { DateTime } = require('luxon');

const checkActivation = require('../index');
const { REGION, ENDPOINT } = require('../../../__tests__/settings');
const { createDB, deleteDB, getHashedText } = require('../../../__tests__/setup.js')
// const { deleteDB } = require('../../../__tests__/everyTearDown.js')
// const crypto = require('crypto');

const { DynamoDBClient, GetItemCommand, PutItemCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");


// async function getHashedText(text) {
//   return crypto.createHash('md5').update(text).digest('hex');
// }

async function setupDb(tableName) {
  console.log("Setting up the DB ")
  const dynamoClient = new DynamoDBClient({
    region: REGION,
    endpoint: ENDPOINT
  });
  const bookingTimeParams = {
      TableName: tableName,
      Item: {
        pk: {S: 'config'},
        sk: {S: 'config',},
        BOOKING_OPENING_HOUR: {N: '7'}
      }
    }
  const openingHourCommand = new PutItemCommand(bookingTimeParams);
  await dynamoClient.send(openingHourCommand);
  const testParkParams = {
      TableName: tableName,
      Item: {
        pk: {S: 'park'},
        sk: {S: 'Test Park'},
        name: {S: 'Test Park'},
        description: {S: 'x'},
        bcParksLink: {S: 'x'},
        status: {S: 'open'},
        visible: {BOOL: true}
      }
    }
  const testParkPutCommand = new PutItemCommand(testParkParams);
  let res2 = await dynamoClient.send(testParkPutCommand);

  console.log("Resposnse In checkActivation test: ", res2)
  const facilityAParams = {
      TableName: tableName,
      Item: {
        pk: {S: 'facility::Test Park'},
        sk: {S: 'Parking Lot A'},
        name: {S: 'Parking Lot A'},
        status: {S: 'open'},
        visible: {BOOL: true},
        qrcode: {BOOL: true},
        type: {S: 'parking'}
      }
    }
  
    const facilityAPutCommand = new PutItemCommand(facilityAParams);
    let res3 = await dynamoClient.send(facilityAPutCommand);
    console.log("Resposnse In checkActivation test: ", res3)
    const facilityBParams = {
      TableName: tableName,
      Item: {
        pk: {S: 'facility::Test Park'},
        sk: {S: 'Parking Lot B'},
        name: {S: 'Parking Lot B'},
        status: {S: 'open'},
        visible: {BOOL: true},
        qrcode: {BOOL: true},
        type: {S: 'parking'},
        bookingOpeningHour: {N: 10},
      }
    }
    
    const facilityBPutCommand = new PutItemCommand(facilityBParams);
    let res4 = await dynamoClient.send(facilityBPutCommand);
    console.log("Resposnse In checkActivation test: ", res4)
}

describe('checkActivationHandler', () => {
  const OLD_ENV = process.env.TABLE_NAME;
  let hash
 
  beforeEach(async () => {
    jest.resetModules();
    hash = getHashedText(expect.getState().currentTestName);
    process.env.TABLE_NAME = hash
    await createDB(hash)
    await setupDb(hash)
  });

  afterEach(async () => {
    await deleteDB(process.env.TABLE_NAME);
    process.env.TABLE_NAME = OLD_ENV; // Restore old environment
  });

  test.each([['AM', '123456702'], ['DAY', '123456703']])('should set %s passes with default opening hour to active', async (passType, sk) => {
    const dynamoClient = new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT
    });
    const passDate = DateTime.fromISO('2021-12-08T19:01:58.135Z').setZone('America/Vancouver');
    const params = {
        TableName: hash,
        Item: {
          pk: {S: 'pass::Test Park'},
          sk: {S: sk},
          facilityName: {S: 'Parking Lot A'},
          type: {S: passType},
          registrationNumber: {S: sk},
          passStatus: {S: 'reserved'},
          date: {S: passDate.toUTC().toISO()}
        }
      }
      console.log("In the test about to put", dynamoClient)
    const res = await dynamoClient.send(new PutItemCommand(params))
    console.log("Resposnse In checkActivation test: ", res)

    MockDate.set(new Date('2021-12-08T19:01:58.135Z'));
    console.log("TableName in test: ", process.env.TABLE_NAME)
    await checkActivation.handler(null, {});
    console.log("TableName in test 2: ", process.env.TABLE_NAME)
    MockDate.reset();

    const getParam = {
        TableName: hash,
        Key: {
          pk: {S: 'pass::Test Park'},
          sk: {S: sk}
        }
      }
    let result = await dynamoClient.send(new GetItemCommand(getParam));
    result = unmarshall(result.Item)
    expect(result.passStatus).toBe('active');
  });

  test.each([['AM', '123456704'], ['DAY', '123456705']])('should leave %s passes inactive before custom opening hour', async (passType, sk) => {
    const dynamoClient = new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT
    });
    const passDate = DateTime.fromISO('2021-12-08T19:01:58.135Z').setZone('America/Vancouver');
    const params = {
        TableName: hash,
        Item: {
          pk: {S: 'pass::Test Park'},
          sk: {S: sk},
          facilityName: {S: 'Parking Lot B'},
          type: {S: passType},
          registrationNumber: {S: sk},
          passStatus: {S: 'reserved'},
          date: {S: passDate.toUTC().toISO()}
        }
      }
    await dynamoClient.send(new PutItemCommand(params));
    MockDate.set(new Date('2021-12-08T17:01:58.135Z'));
    await checkActivation.handler(null, {});
    MockDate.reset();

    const getParam = {
        TableName: hash,
        Key: {
          pk: {S: 'pass::Test Park'},
          sk: {S: sk},
        }
      }
    let result = await dynamoClient.send(new GetItemCommand(getParam));
    result = unmarshall(result.Item);
    expect(result.passStatus).toBe('reserved');
  });

  test.each([['AM', '123456706'], ['DAY', '123456707']])('should set %s passes to active after custom opening hour', async (passType, sk) => {
    const dynamoClient = new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT
    });
    const passDate = DateTime.fromISO('2021-12-08T19:01:58.135Z').setZone('America/Vancouver');
    const params = {
        TableName: hash,
        Item: {
          pk: {S: 'pass::Test Park'},
          sk: {S: sk},
          facilityName: {S: 'Parking Lot B'},
          type: {S: passType},
          registrationNumber: {S: sk},
          passStatus: {S: 'reserved'},
          date: {S: passDate.toUTC().toISO()}
        }
      }
    res = await dynamoClient.send(new PutItemCommand(params))
    console.log("Resposnse In checkActivation test: ", res)
;   MockDate.set(new Date('2021-12-08T18:00:00.00Z'));
    await checkActivation.handler(null, {});
    MockDate.reset();

    const getParam = {
        TableName: hash,
        Key: {
          pk: {S: 'pass::Test Park'},
          sk: {S: sk},
        }
      }
    let result = await dynamoClient.send(new GetItemCommand(getParam));
    result = unmarshall(result.Item);
    expect(result.passStatus).toBe('active');
  });

  test('should leave PM passes before 12:00 inactive', async () => {
    const dynamoClient = new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT
    });
    const passDate = DateTime.fromISO('2021-12-08T19:01:58.135Z').setZone('America/Vancouver');
    const params = {
        TableName: hash,
        Item: {
          pk: {S: 'pass::Test Park'},
          sk: {S: '123456708'},
          facilityName: {S: 'Parking Lot A'},
          type: {S: 'PM'},
          registrationNumber: {S: '123456708'},
          passStatus: {S: 'reserved'},
          date: {S: passDate.toUTC().toISO()}
        }
      }
    const res = await dynamoClient.send(new PutItemCommand(params));
    console.log("Resposnse In checkActivation test: ", res)
    MockDate.set(new Date('2021-12-08T19:59:59.999Z'));
    await checkActivation.handler(null, {});
    MockDate.reset();

    const getParam = {
        TableName: hash,
        Key: {
          pk: {S: 'pass::Test Park'},
          sk: {S: '123456708'}
        }
      }
    let result2 = await dynamoClient.send(new GetItemCommand(getParam)); 
    result2 = unmarshall(result2.Item)
    expect(result2.passStatus).toBe('reserved');
  });

  test('should set PM passes after 12:00 to active', async () => {
    const dynamoClient = new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT
    });
    const passDate = DateTime.fromISO('2021-12-08T19:01:58.135Z').setZone('America/Vancouver');
    const params = {
        TableName: hash,
        Item: {
          pk: {S: 'pass::Test Park'},
          sk: {S: '123456709'},
          facilityName: {S: 'Parking Lot A'},
          type: {S: 'PM'},
          registrationNumber: {S: '123456709'},
          passStatus: {S: 'reserved'},
          date: {S: passDate.toUTC().toISO()}
        }
      }
    const res = await dynamoClient.send(new PutItemCommand(params))
    console.log("Resposnse In checkActivation test: ", res)
    MockDate.set(new Date('2021-12-08T22:01:58.135Z'));
    await checkActivation.handler(null, {});
    MockDate.reset();

    const getParam = {
        TableName: hash,
        Key: {
          pk: {S: 'pass::Test Park'},
          sk: {S: '123456709'}
        }
      }
    let result = await dynamoClient.send(new GetItemCommand(getParam));
    result = unmarshall(result.Item)
    expect(result.passStatus).toBe('active');
  });
});
