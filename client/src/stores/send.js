import { ref } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { useConnectStore } from './connect.js'

export const useSendStore = defineStore('send', () => {
  const connectStore = useConnectStore()
  const { sendChannels } = storeToRefs(connectStore)

  const uploadFileItems = ref([])

  function addUploadFileItem(url, name, size, progress, type) {
    uploadFileItems.value.push({
      url,
      name,
      size,
      progress,
      type,
    })

    uploadFileItems.value = [...uploadFileItems.value] // trigger reactivity
  }

  function updateFileProgress(index, progress) {
    uploadFileItems.value[index].progress = progress

    uploadFileItems.value = [...uploadFileItems.value] // trigger reactivity
  }

  function updateFileUrl(index, url) {
    uploadFileItems.value[index].url = url

    uploadFileItems.value = [...uploadFileItems.value] // trigger reactivity
  }

  function updateFileSuccess(index, success) {
    uploadFileItems.value[index].success = success

    uploadFileItems.value = [...uploadFileItems.value] // trigger reactivity
  }

  let currentSendingFileNo = -1

  let chunkQueue = []

  for (let i = 0; i < sendChannels.value.length; i++) {
    sendChannels.value[i].value.onbufferedamountlow = async () => {
      // console.log(`[INFO] Channel ${i} buffered amount low`)
      await processQueue()
    }
  }

  async function sendData(data, meta = false) {
    chunkQueue.push(data)

    await processQueue(meta)
  }

  async function processQueue(meta) {
    let sendChannel = null
    if (meta) {
      sendChannel = sendChannels.value[0]
    } else {
      const sendChannelIdx = Math.floor(Math.random() * sendChannels.value.length)
      sendChannel = sendChannels.value[sendChannelIdx]
      // console.log(`[INFO] Sending data to channel ${sendChannelIdx}`)
    }

    while (
      chunkQueue.length > 0 &&
      sendChannel.value.bufferedAmount <= connectStore.maxBufferedAmount
    ) {
      let chunk = chunkQueue.shift()

      if (!(chunk instanceof ArrayBuffer) && !ArrayBuffer.isView(chunk)) {
        chunk = new TextEncoder().encode(chunk)
      }

      sendChannel.value.send(chunk)
    }
  }

  let currentFileType = ''
  const currentFileName = ref('Drop file here or click to upload')
  const currentFileSize = ref(0)
  const chunkSize = 16384
  let fileReader = null
  const offset = ref(0)

  async function sendFiles(files, type) {
    // Send the file meta and content
    // console.log(`[INFO] ===Sending ${files.length} files===`)

    // console.log(`files: ${files}`)

    const fileNum = files.length

    if (fileNum === 0) {
      console.error(`[ERR] No file selected`)
      return
    }

    for (let i = 0; i < fileNum; i++) {
      await sendFileMeta(files[i], type)
      currentSendingFileNo++
      await sendFileContent(files[i], type)
      // TODO: Why this works? Why? Why? Why?
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  async function sendFileMeta(file, type) {
    // Send the type, name, and size of the file
    // console.log(`file: ${file}`)
    if (!checkSendFileAvailability(file.size)) return

    await sendData('CONTENT_META' + type, true)
    await sendData('CONTENT_META' + file.name, true)
    await sendData('CONTENT_META' + file.size, true)

    // console.log(`[INFO] Sent meta: ${type} | ${file.name} | ${file.size}`)

    addUploadFileItem('javascript:void(0)', file.name, file.size, 0, type)
  }

  async function sendFileContent(file, type) {
    if (!checkSendFileAvailability(file.size)) return

    currentFileType = type
    currentFileName.value = file.name
    currentFileSize.value = file.size

    console.log(
      `[INFO] Sending file ${currentFileType} | ${currentFileName.value} | ${currentFileSize.value}`,
    )

    await addFileReader()

    let currentChunkIdx = 0

    const readAndSendSlice = o => {
      return new Promise((resolve, reject) => {
        if (o >= currentFileSize.value) {
          resolve()
          return
        }

        const fileReaderSendData = async e => {
          const currentChunkIdxArray = new Uint8Array(2)
          currentChunkIdxArray[0] = (currentChunkIdx & 0xff00) >> 8
          currentChunkIdxArray[1] = currentChunkIdx & 0xff

          const dataArray = new Uint8Array(e.target.result.byteLength + 2)
          dataArray.set(currentChunkIdxArray, 0)
          dataArray.set(new Uint8Array(e.target.result), 2)

          // console.log(`[INFO] Sending chunk ${currentChunkIdx}`)

          currentChunkIdx++

          await sendData(dataArray)
          offset.value = offset.value + e.target.result.byteLength
          if (offset.value < currentFileSize.value) {
            resolve(
              updateFileProgress(currentSendingFileNo, offset.value),
              readAndSendSlice(offset.value),
            )
          } else {
            resolve(
              updateFileProgress(currentSendingFileNo, currentFileSize.value),
              updateFileUrl(currentSendingFileNo, URL.createObjectURL(file)),
              updateFileSuccess(currentSendingFileNo, true),
            )
          }
        }

        fileReader.onerror = error => {
          reject(error)
        }

        fileReader.onload = fileReaderSendData

        const slice = file.slice(o, o + chunkSize - 2)
        fileReader.readAsArrayBuffer(slice)
      })
    }

    offset.value = 0

    await readAndSendSlice(0)
  }

  async function addFileReader() {
    fileReader = new FileReader()

    fileReader.addEventListener('error', error => {
      console.error(`[ERR] Error reading file: ${error}`)
    })

    fileReader.addEventListener('abort', event => {
      console.log(`[INFO] File reading aborted: ${event}`)
    })
  }

  function checkSendFileAvailability(size) {
    // Check if the file is empty or the data channel is open
    if (size === 0) {
      console.error(`[ERR] File is empty`)
      return false
    }

    if (connectStore.getSendChannelState() !== 'open') {
      console.error('[ERR] Data channel is not open')
      return false
    }

    return true
  }

  async function sendText(text) {
    // Send the file meta and content
    // console.log(`[INFO] ===Sending text===`)

    await sendTextContent(text)
  }

  async function sendTextContent(text) {
    // Send the type, name, and size of the file
    if (!checkSendTextAvailability(text)) return

    await sendData('CONTENT_META' + 'TRANSFER_TYPE_TEXT', true)
    await sendData('CONTENT_META' + text, true)
    await sendData('CONTENT_META' + text.length, true)

    // console.log(
    //   `[INFO] Sent content: ${'TRANSFER_TYPE_TEXT'} | ${text} | ${text.length}`,
    // )

    addUploadFileItem(
      'javascript:void(0)',
      text,
      text.length,
      text.length,
      'TRANSFER_TYPE_TEXT',
    )

    currentSendingFileNo++

    updateFileSuccess(currentSendingFileNo, true)
  }

  function checkSendTextAvailability(text) {
    // Check if the text.valuepty or the data channel is open
    if (text === '') {
      console.error('[ERR] Text is empty')
      return false
    }

    if (connectStore.getSendChannelState() !== 'open') {
      console.error('[ERR] Data channel is not open')
      return false
    }

    return true
  }

  return {
    uploadFileItems,
    sendFiles,
    sendText,
    processQueue,
  }
})
