#
# ClawOS - AndroidProducts.mk
#
# Register ClawOS product variants for the lunch menu.
# Both products share clawos_common.mk for ClawOS customizations.
#

PRODUCT_MAKEFILES := \
    $(LOCAL_DIR)/sdk_clawos_arm64.mk \
    $(LOCAL_DIR)/clawos_gsi_arm64.mk

COMMON_LUNCH_CHOICES := \
    sdk_clawos_arm64-trunk_staging-userdebug \
    sdk_clawos_arm64-trunk_staging-eng \
    clawos_gsi_arm64-trunk_staging-userdebug \
    clawos_gsi_arm64-trunk_staging-eng
