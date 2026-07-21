import { describe, expect, it } from 'vitest'

import ChatView from '@/views/ChatView.vue'
import { mount } from '@vue/test-utils'

describe('ChatView', () => {
  it('renders properly', () => {
    const wrapper = mount(ChatView)
    expect(wrapper.find('textarea').attributes('placeholder')).toBe('输入任务，回车执行...')
  })
})
