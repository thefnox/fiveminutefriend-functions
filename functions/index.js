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
        ref.child(`${userId}/matches`).push()
          .set({
            otherId
          });
        ref.child(`${otherId}/matches`).push()
          .set({
            userId
          });

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
