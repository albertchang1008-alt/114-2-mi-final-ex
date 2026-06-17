const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json'); // assuming it exists from earlier
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.collection('answerBatches').orderBy('createdAt', 'desc').limit(5).get().then(snap => {
  snap.forEach(doc => console.log(doc.id, doc.data().createdAt, doc.data().email));
  process.exit(0);
}).catch(console.error);
