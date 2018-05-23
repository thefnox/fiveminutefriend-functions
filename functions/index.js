const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

exports.matchUsers = functions.database.ref('/Matches/{userId}')
  .onWrite((snapshot, context) => {
    const {userId} = context.params;
    if (!snapshot.after.val()){
      console.log(`User ${userId} cancelled matching.`);
      return null
    }

    const filters = snapshot.after.val();
    const {myToken, ageMin, ageMax, languages, gender} = filters;

    return snapshot.after.ref.parent.once('value', (data) => {
      let matched = false;
      data.forEach((other) => {
        if (matched){
          return;
        }
        const age = other.child("myAge").val();
        const sex = other.child("myGender").val();
        const language = other.child("myLanguage").val();
        const key = other.key;
        if (key !== userId && (age >= ageMin && age <= ageMax) && languages.includes(language) && (((gender >>> sex) & 1) > 0)) {
          matched = [key, other.child("myToken").val()];
          return true;
        }
      });

      if (matched){
        const [otherId, otherToken] = matched;
        const ref = admin.database().ref('/Users');
        console.log(`Found match for ${userId}, ${otherId}`);
        ref.child(`${userId}/matches/${otherId}`).set(Date.now());
        ref.child(`${otherId}/matches/${userId}`).set(Date.now());

        return Promise.all([
          admin.messaging().send({
            data: {
              title: 'You have a new match!',
              matchId: `${otherId}`,
            },
            token: myToken
          }),
          admin.messaging().send({
            data: {
              title: 'You have a new match!',
              matchId: `${userId}`,
            },
            token: otherToken
          }),
          snapshot.after.ref.parent.child(userId).remove(),
          snapshot.after.ref.parent.child(otherId).remove()
        ]);
      }
      else{
        console.log("Couldn't find match");
        return null;
      }
    });
  });

exports.addFriends = functions.database.ref('/FriendRequest/{userId}')
  .onWrite((snapshot, context) => {
    const {userId} = context.params;
    if (!snapshot.after.val()){
      console.log(`User ${userId} cancelled requesting.`);
      return null
    }
    return snapshot.after.ref.parent.once('value', (data) => {
      let match;
      let otherId;
      const ref = admin.database().ref('/Users');
      data.forEach((other) => {
        if (match){
          return;
        }
        otherId = other.key;
        match = other.val().contains(userId) && snapshot.after.val().contains(otherId);
      });
      if (match){
        ref.child(`${userId}/friends/${otherId}`).set(Date.now());
        ref.child(`${otherId}/friends/${userId}`).set(Date.now());
        return Promise.all([
          snapshot.after.ref.parent.child(userId).remove(),
          snapshot.after.ref.parent.child(otherId).remove()
        ]);
      }
      return null;
    });
  });

exports.sendMessage = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called ' +
      'while authenticated.');
  }
  const {receiverUid, msgType, text, timeSent} = data;
  const {uid} = context.auth;
  const ref = admin.database().ref(`Users/${uid}`);
  const messages = admin.database().ref(`Messages/${uid}/${receiverUid}`);
  return ref.once('value', (user) => {
    const match = (user.val().matches || {})[receiverUid];
    if ((user.val().friends || {})[receiverUid] || (match && ((Date.now() - match) <= 300000))){
      messages.push({
        deliveryStatus: 0,
        msgType,
        text,
        timeReceived: Date.now(),
        timeSent
      });
    }
    else{
      throw new functions.https.HttpsError('failed-precondition', 'You are not allowed to message this user');
    }
  }).then(() => {
      return {
        status: 'Sent',
        text
      }
    })
    .catch(err => {
      throw err
    });
});
