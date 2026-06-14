function parseFirestoreValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return parseFloat(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) {
    var arr = v.arrayValue.values || [];
    return arr.map(parseFirestoreValue);
  }
  if ('mapValue' in v) {
    var obj = {};
    var fields = v.mapValue.fields || {};
    Object.keys(fields).forEach(function(k) { obj[k] = parseFirestoreValue(fields[k]); });
    return obj;
  }
  if ('nullValue' in v) return null;
  return v;
}

function parseFirestoreDoc(doc) {
  var obj = {};
  var fields = doc.fields || {};
  Object.keys(fields).forEach(function(k) { obj[k] = parseFirestoreValue(fields[k]); });
  return obj;
}

const rawDocs = [
  {
    name: "projects/xyz",
    fields: {
      studentId: { stringValue: "113510579" },
      className: { stringValue: "1班" },
      score: { integerValue: "80" },
      details: {
        arrayValue: {
          values: [
            { mapValue: { fields: { questionId: { stringValue: "q1" } } } }
          ]
        }
      }
    }
  }
];

const docs = rawDocs.map(parseFirestoreDoc);
console.log(JSON.stringify(docs, null, 2));
