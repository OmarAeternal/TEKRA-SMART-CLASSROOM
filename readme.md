# Smart Campus Monitoring System
pada file ini disematkan berupa kode-kode prototype berupa simulasi untuk menggambarkan lebih jelas alur sistem yang dirancang.
## Struktur Folder

```text
project/
│
├── gateway/
│   └──gateway.ino
│
├── ruangan/
│   └──ruangan.ino
│
│
├── kursi/
│   └── kursi1.ino
|   |__ kursi2.ino
│
├── frontend/
│   ├── digitwin3.html //utama
|   |__ fen.html
|   |__ src.js
│   
│   
│  
│
└── README.md



ESP32 Sensor
    ↓
MQTT Broker (HiveMQ)
    ↓
ESP32 Gateway
    ↓
Frontend Dashboard / Database


topic
smartcampus/demo1/room
smartcampus/demo1/seat/seat_1
smartcampus/demo1/seat/seat_2
...
smartcampus/demo1/summary
```

setup HiveMQ
1. buka https://www.hivemq.com/demos/websocket-client/
2. set host: broker.hivemq.com
3. set port: 8884
4. subscribe topic: smartcampus/demo1/summary

buka link wokwi dan jalankan.

# Alur Analisis dan Konsep Solusi

## Permasalahan

Pengawasan ruang kelas di lingkungan kampus masih dilakukan secara manual melalui patroli fisik. Kondisi ini menyebabkan keterlambatan dan kegagalan dalam mengetahui apakah ruangan masih digunakan atau tidak. Akibatnya, lampu dan pendingin ruangan sering tetap menyala meskipun ruang kelas kosong sehingga menimbulkan pemborosan energi.

Selain itu, kondisi lingkungan ruang kelas seperti suhu, kualitas udara, pencahayaan, dan tingkat kebisingan juga belum dapat dipantau secara real-time. Pengelola fasilitas kampus masih kesulitan mengetahui titik pemborosan energi secara spesifik karena data konsumsi listrik hanya tersedia pada level gedung secara umum.

---

# Konsep Solusi

Sistem Smart Campus ini dirancang menggunakan pendekatan Internet of Things (IoT) dan Digital Twin untuk memantau kondisi ruang kelas secara real-time.

Beberapa node ESP32 digunakan sebagai perangkat sensing untuk membaca:
- suhu dan kelembapan
- kualitas udara
- intensitas cahaya
- tingkat kebisingan
- status okupansi kursi
- aktivitas pengguna

Data sensor dikirim menggunakan protokol MQTT menuju gateway dan server untuk diproses secara realtime.

Sistem kemudian melakukan evaluasi kondisi ruangan menggunakan sensor fusion dan comfort scoring untuk menentukan apakah kondisi ruang masih ideal atau memerlukan tindakan otomatis.

Apabila ruangan terdeteksi kosong dalam periode tertentu, sistem akan mematikan relay secara otomatis untuk memutus aliran listrik perangkat seperti lampu dan pendingin ruangan.

---

# Alur Sistem

1. Sensor membaca kondisi lingkungan dan okupansi ruang kelas.
2. ESP32 mengirim data sensor melalui MQTT Broker.
3. Gateway menerima dan merangkum seluruh data sensor.
4. Server/komputer melakukan analisis kondisi ruangan dan evaluasi efisiensi energi.
5. Dashboard Digital Twin menampilkan kondisi ruang kelas secara realtime.
6. Data historis disimpan untuk evaluasi penggunaan energi dan pengambilan keputusan.

---

# Visualisasi Dashboard

Dashboard menampilkan:
- kondisi ruangan realtime
- status relay/listrik
- status kursi
- grafik sensor
- event alert
- visualisasi Digital Twin 3D

Digital Twin akan berubah sesuai kondisi aktual ruangan, misalnya:
- warna ruangan berubah berdasarkan suhu
- kursi berubah warna saat digunakan
- lampu virtual menyala atau mati mengikuti relay

---

# Tujuan Sistem

Sistem ini dikembangkan untuk:
- mengurangi pemborosan energi
- meningkatkan efisiensi fasilitas kampus
- membantu monitoring ruang kelas secara realtime
- menyediakan data historis untuk evaluasi energi
- mendukung implementasi Smart Campus berbasis data