import User from '../../genshin/model/user.js'
import MysSRApi from '../runtime/MysSRApi.js'
import setting from '../utils/setting.js'
import fetch from 'node-fetch'
import _ from 'lodash'
import YAML from 'yaml'
import fs from 'fs'
import { rulePrefix } from '../utils/common.js'
export class Note extends plugin {
  constructor (e) {
    super({
      name: '星铁plugin-体力',
      dsc: '星穹铁道体力信息',
      /** https://oicqjs.github.io/oicq/#events */
      event: 'message',
      priority: setting.getConfig('gachaHelp').noteFlag ? 5 : 500,
      rule: [
        {
          reg: `^${rulePrefix}体力$`,
          fnc: 'note'
        }
      ]
    })
    this.User = new User(e)
  }

  async note (e) {
    let user = this.e.user_id
    let ats = e.message.filter(m => m.type === 'at')
    if (ats.length > 0 && !e.atBot) {
      user = ats[0].qq
      this.e.user_id = user
      this.User = new User(this.e)
    }
    let userData = await this.miYoSummerGetUid()
    let uid = await redis.get(`STAR_RAILWAY:UID:${user}`)
    if (userData.game_uid) {
      uid = userData.game_uid
    } else {
      await e.reply('当前使用的ck无星穹铁道角色，如绑定多个ck请尝试切换ck')
      return false
    }
    if (!uid) {
      await e.reply('尚未绑定uid,请发送#星铁绑定uid进行绑定')
      return false
    }
    let ck = await this.User.getCk()
    if (!ck || Object.keys(ck).filter(k => ck[k].ck).length === 0) {
      await e.reply('尚未绑定cookie, 请发送#cookie帮助查看帮助')
      return false
    }

    let api = new MysSRApi(uid, ck)
    let deviceFp = await redis.get(`STARRAIL:DEVICE_FP:${uid}`)
    if (!deviceFp) {
      let sdk = api.getUrl('getFp')
      let res = await fetch(sdk.url, { headers: sdk.headers, method: 'POST', body: sdk.body })
      let fpRes = await res.json()
      deviceFp = fpRes?.data?.device_fp
      if (deviceFp) {
        await redis.set(`STARRAIL:DEVICE_FP:${uid}`, deviceFp, { EX: 86400 * 7 })
      }
    }
    const { url, headers } = api.getUrl('srNote', { deviceFp })
    logger.mark({ url, headers })
    let res = await fetch(url, {
      headers
    })

    let cardData = await res.json()
    await api.checkCode(this.e, cardData, 'srNote')
    if (cardData.retcode !== 0) {
      return false
    }

    let data = cardData.data
    const icons = YAML.parse(
      fs.readFileSync(setting.configPath + 'dispatch_icon.yaml', 'utf-8')
    )
    logger.mark(icons)
    data.expeditions.forEach(ex => {
      ex.remaining_time = formatDuration(ex.remaining_time)
      ex.icon = icons[ex.name]
      if (ex.remaining_time == '00时00分') ex.remaining_time = '委托已完成'
    })
    logger.warn(data.expeditions)
    if (data.max_stamina === data.current_stamina) {
      data.ktl_full = '开拓力已全部恢复'
    } else {
      data.ktl_full = `${formatDuration(data.stamina_recover_time)}`
      data.ktl_full_time_str = getRecoverTimeStr(data.stamina_recover_time)
    }
    data.uid = uid // uid显示
    data.ktl_name = e.nickname // 名字显示
    data.ktl_qq = parseInt(e.user_id) // QQ头像
    await e.runtime.render('StarRail-plugin', '/note/note.html', data)
  }

  async miYoSummerGetUid () {
    let key = `STAR_RAILWAY:UID:${this.e.user_id}`
    let ck = this.User.getCk()
    if (!ck) return false
    // if (await redis.get(key)) return false
    // todo check ck
    let api = new MysSRApi('', ck)
    let userData = await api.getData('srUser')
    if (!userData?.data || _.isEmpty(userData.data.list)) return false
    userData = userData.data.list[0]
    let { game_uid: gameUid } = userData
    await redis.set(key, gameUid)
    await redis.setEx(
      `STAR_RAILWAY:userData:${gameUid}`,
      60 * 60,
      JSON.stringify(userData)
    )
    return userData
  }
}

function formatDuration (seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours.toString().padStart(2, '0')}时${minutes
    .toString()
    .padStart(2, '0')}分`
}

/**
 * 获取开拓力完全恢复的具体时间文本
 * @param {number} seconds 秒数
 */
function getRecoverTimeStr (seconds) {
  const now = new Date()
  const dateTimes = now.getTime() + seconds * 1000
  const date = new Date(dateTimes)
  const dayDiff = date.getDate() - now.getDate()
  const str = dayDiff === 0 ? '今日' : '明日'
  const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`
  return `预计[${str}]${timeStr}完全恢复`
}
