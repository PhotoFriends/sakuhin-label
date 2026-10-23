// Firebase のウェブ用設定（公開して問題ない値。データの保護は firestore.rules で行う）
// 同じアプリを2か所で公開していて、公開先ごとにデータ（Firebase プロジェクト）を分けている。
const CONFIGS = {
  // umi-card.github.io/sakuhin-label
  main: {
    apiKey: "AIzaSyACnK3SvHaxR-d2VDaQhUVCvBOBdUmGXVg",
    authDomain: "sakuhin-label-1021.firebaseapp.com",
    projectId: "sakuhin-label-1021",
    storageBucket: "sakuhin-label-1021.firebasestorage.app",
    messagingSenderId: "332252400640",
    appId: "1:332252400640:web:4ae1730899a747fbf25ce5",
  },
  // photofriends.github.io/sakuhin-label
  photofriends: {
    apiKey: "AIzaSyAYM-0A2v60eQsC2P4dzNz2Opmr8VgmeNw",
    authDomain: "sakuhin-label-pf-1023.firebaseapp.com",
    projectId: "sakuhin-label-pf-1023",
    storageBucket: "sakuhin-label-pf-1023.firebasestorage.app",
    messagingSenderId: "490985774905",
    appId: "1:490985774905:web:34ab757f4183ae831f92e8",
  },
};

// ?site=photofriends で、ローカルでも PhotoFriends 側のデータを使える
const site = new URLSearchParams(location.search).get("site")
  || (location.hostname === "photofriends.github.io" ? "photofriends" : "main");

export const firebaseConfig = CONFIGS[site] || CONFIGS.main;
