Pod::Spec.new do |s|
  s.name           = 'BarguNativeCrypto'
  s.version        = '1.0.0'
  s.summary        = 'Ed25519 and X25519 for Bargu through Apple CryptoKit'
  s.description    = 'Native curve operations for the Bargu E2EE protocol (docs/ADR/0007).'
  s.author         = 'Bargu'
  s.homepage       = 'https://github.com/SerkanFidanci/Bargu'
  s.license        = { type: 'Proprietary' }
  s.platforms      = { :ios => '16.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.swift"
end
