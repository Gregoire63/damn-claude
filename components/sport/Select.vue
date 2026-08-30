<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

// Menu déroulant « maison » : remplace le <select> natif (dont la liste d'options
// ne peut pas être stylée) par un bouton + une liste entièrement contrôlée.
const props = defineProps<{ modelValue: string; options: { key: string; label: string }[] }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const currentLabel = computed(() => props.options.find(o => o.key === props.modelValue)?.label ?? '—')

function pick(k: string) { emit('update:modelValue', k); open.value = false }
function onDocClick(e: MouseEvent) { if (root.value && !root.value.contains(e.target as Node)) open.value = false }
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="root" class="cselect" :class="{ open }">
    <button type="button" class="cselect-btn" :aria-expanded="open" @click="open = !open" @keydown.esc="open = false">
      <span class="cselect-value">{{ currentLabel }}</span>
      <span class="cselect-chev" aria-hidden="true">▾</span>
    </button>
    <transition name="cselect-pop">
      <ul v-if="open" class="cselect-list" role="listbox">
        <li
          v-for="o in options" :key="o.key" role="option" :aria-selected="o.key === modelValue"
          class="cselect-opt" :class="{ sel: o.key === modelValue }" @click="pick(o.key)"
        >
          <span>{{ o.label }}</span>
          <span v-if="o.key === modelValue" class="cselect-check" aria-hidden="true">✓</span>
        </li>
      </ul>
    </transition>
  </div>
</template>
